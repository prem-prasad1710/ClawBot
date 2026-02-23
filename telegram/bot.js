/**
 * telegram/bot.js
 * Telegram bot interface for ClawBot.
 * Handles commands, streams status updates, manages concurrent tasks.
 */

import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import os from 'os';
import { AgentLoop } from '../agent/loop.js';
import { AgentMemory } from '../agent/memory.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

export class ClawBotTelegram {
  constructor() {
    if (!config.telegram.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set in .env');
    }

    this._pollingRestartDelay = 5000; // ms, doubles on each consecutive failure
    this._pollingFailures = 0;

    this.bot = new TelegramBot(config.telegram.token, {
      polling: {
        interval: 1000,      // ms between polls
        autoStart: true,
        params: { timeout: 30 }, // long-poll timeout in seconds
      },
      request: {
        agentOptions: {
          keepAlive: true,
          timeout: 60000,
        },
      },
    });
    this.memory = new AgentMemory();
    this.activeLoops = new Map(); // chatId → AgentLoop
    this._registerHandlers();
    logger.info('[Telegram] Bot started and polling.');
  }

  // ─────────────────────────────────────────────
  // Handler registration
  // ─────────────────────────────────────────────

  _registerHandlers() {
    const bot = this.bot;

    bot.onText(/\/start/, (msg) => this._handleStart(msg));
    bot.onText(/\/help/, (msg) => this._handleHelp(msg));
    bot.onText(/\/task (.+)/, (msg, match) => this._handleTask(msg, match[1].trim()));
    bot.onText(/\/stop/, (msg) => this._handleStop(msg));
    bot.onText(/\/status/, (msg) => this._handleStatus(msg));
    bot.onText(/\/history/, (msg) => this._handleHistory(msg));
    bot.onText(/\/model (.+)/, (msg, match) => this._handleModelChange(msg, match[1].trim()));
    bot.onText(/\/models/, (msg) => this._handleListModels(msg));
    bot.onText(/\/workspace/, (msg) => this._handleWorkspace(msg));
    bot.onText(/\/clear/, (msg) => this._handleClear(msg));

    bot.on('message', (msg) => {
      // Catch plain text (non-command) and treat as task
      if (msg.text && !msg.text.startsWith('/')) {
        this._handleTask(msg, msg.text.trim());
      }
    });

    bot.on('polling_error', (err) => {
      logger.error(`[Telegram] Polling error: ${err.code || ''} ${err.message}`);

      // EFATAL = unrecoverable network error (e.g. TLS drop) – restart polling
      if (err.code === 'EFATAL' || (err.message && err.message.includes('EFATAL'))) {
        this._pollingFailures++;
        const delay = Math.min(this._pollingRestartDelay * this._pollingFailures, 60000);
        logger.warn(`[Telegram] Restarting polling in ${delay / 1000}s (attempt ${this._pollingFailures})...`);

        bot.stopPolling()
          .catch(() => {})
          .finally(() => {
            setTimeout(() => {
              bot.startPolling({ restart: true })
                .then(() => {
                  logger.info('[Telegram] Polling restarted successfully.');
                  this._pollingFailures = 0; // reset on success
                })
                .catch((e) => logger.error(`[Telegram] Failed to restart polling: ${e.message}`));
            }, delay);
          });
      }
    });
  }

  // ─────────────────────────────────────────────
  // Guards
  // ─────────────────────────────────────────────

  _isAuthorized(msg) {
    if (!config.telegram.allowedUsers.length) return true; // open mode
    return config.telegram.allowedUsers.includes(msg.from?.id);
  }

  _chatId(msg) {
    return msg.chat.id;
  }

  async _send(chatId, text, options = {}) {
    try {
      return await this.bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...options,
      });
    } catch (err) {
      // Telegram may reject messages with special characters – retry plain
      try {
        return await this.bot.sendMessage(chatId, text.replace(/[*_`[\]()]/g, ''), options);
      } catch (e2) {
        logger.error(`[Telegram] Failed to send message: ${e2.message}`);
      }
    }
  }

  async _editOrSend(chatId, messageId, text) {
    try {
      return await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
      });
    } catch {
      return this._send(chatId, text);
    }
  }

  // ─────────────────────────────────────────────
  // Command handlers
  // ─────────────────────────────────────────────

  async _handleStart(msg) {
    const chatId = this._chatId(msg);
    const name = msg.from?.first_name || 'developer';
    await this._send(chatId, `👋 Hello *${name}*! I'm *ClawBot* – your autonomous AI developer agent.\n\nSend me a task or use /help to see all commands.`);
  }

  async _handleHelp(msg) {
    const chatId = this._chatId(msg);
    const help = [
      '*ClawBot Commands*',
      '',
      '`/task <description>` – Run an autonomous task',
      '`/stop` – Stop the current task',
      '`/status` – Show agent status and stats',
      '`/history` – Show recent task history',
      '`/model <name>` – Switch Ollama model (e.g. deepseek-coder)',
      '`/models` – List available Ollama models',
      '`/workspace` – Show workspace directory',
      '`/clear` – Clear current task context',
      '',
      '*Or just type your task directly!*',
      '',
      '*Example tasks:*',
      '• `build a Node.js REST API with Express`',
      '• `research best React chart libraries and install the top one`',
      '• `fix the TypeScript errors in my project`',
      '• `open localhost:3000 and test the login page`',
    ].join('\n');
    await this._send(chatId, help);
  }

  async _handleTask(msg, task) {
    const chatId = this._chatId(msg);

    if (!this._isAuthorized(msg)) {
      await this._send(chatId, '⛔ Unauthorized. Your user ID is not in the allowed list.');
      return;
    }

    if (this.activeLoops.has(chatId)) {
      await this._send(chatId, '⚠️ A task is already running. Use /stop to cancel it first.');
      return;
    }

    const workDir = path.join(config.agent.workspaceDir, `session_${chatId}`);

    // Create a status updater that sends chunked messages to Telegram
    let lastMsgId = null;
    let buffer = '';
    let lastFlush = Date.now();

    const flush = async () => {
      if (!buffer.trim()) return;
      const text = buffer;
      buffer = '';
      lastFlush = Date.now();
      const sent = await this._send(chatId, text);
      if (sent) lastMsgId = sent.message_id;
    };

    const onStatusUpdate = async (text) => {
      // Short messages go immediately; longer updates are batched
      if (text.length > 100 || Date.now() - lastFlush > 3000) {
        await flush();
        const sent = await this._send(chatId, text);
        if (sent) lastMsgId = sent.message_id;
      } else {
        buffer += (buffer ? '\n' : '') + text;
      }
    };

    const loop = new AgentLoop({ onStatusUpdate });
    this.activeLoops.set(chatId, loop);

    await this._send(chatId, `🚀 Starting task:\n*${task}*`);

    try {
      const result = await loop.run(task, workDir);
      await flush();

      const icon = result.success ? '✅' : '❌';
      await this._send(
        chatId,
        `${icon} *Task finished* (${result.steps} steps)\n\n${result.summary}`
      );
    } catch (err) {
      await this._send(chatId, `💥 Fatal error: ${err.message}`);
      logger.error(`[Telegram] Task error: ${err.stack}`);
    } finally {
      this.activeLoops.delete(chatId);
    }
  }

  async _handleStop(msg) {
    const chatId = this._chatId(msg);
    const loop = this.activeLoops.get(chatId);
    if (loop) {
      loop.stop();
      await this._send(chatId, '⏹️ Stopping task…');
    } else {
      await this._send(chatId, 'ℹ️ No task is currently running.');
    }
  }

  async _handleStatus(msg) {
    const chatId = this._chatId(msg);
    const isRunning = this.activeLoops.has(chatId);
    const stats = this.memory.getStats();
    const lines = [
      `*ClawBot Status*`,
      `Model: \`${config.ollama.model}\``,
      `Task running: ${isRunning ? '🟢 Yes' : '⚪ No'}`,
      `Total tasks: ${stats.total}`,
      `Success: ${stats.success} | Failed: ${stats.failed}`,
      `Workspace: \`${config.agent.workspaceDir}\``,
    ];
    await this._send(chatId, lines.join('\n'));
  }

  async _handleHistory(msg) {
    const chatId = this._chatId(msg);
    const recent = this.memory.getRecentTasks(10);
    if (!recent.length) {
      await this._send(chatId, 'ℹ️ No task history yet.');
      return;
    }
    const lines = recent.map(
      (t, i) =>
        `${i + 1}. ${t.success ? '✅' : '❌'} \`${t.task.slice(0, 60)}\`\n   _${t.timestamp}_`
    );
    await this._send(chatId, `*Recent Tasks:*\n\n${lines.join('\n\n')}`);
  }

  async _handleModelChange(msg, model) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    config.ollama.model = model;
    await this._send(chatId, `✅ Switched to model: \`${model}\``);
  }

  async _handleListModels(msg) {
    const chatId = this._chatId(msg);
    try {
      const { default: fetch } = await import('node-fetch');
      const resp = await fetch(`${config.ollama.baseUrl}/api/tags`);
      const data = await resp.json();
      const models = (data.models || []).map((m) => `• \`${m.name}\``);
      const text = models.length
        ? `*Available models:*\n${models.join('\n')}`
        : 'No models found. Run `ollama pull deepseek-coder` to download one.';
      await this._send(chatId, text);
    } catch (err) {
      await this._send(chatId, `❌ Could not reach Ollama: ${err.message}`);
    }
  }

  async _handleWorkspace(msg) {
    const chatId = this._chatId(msg);
    await this._send(chatId, `📁 Workspace: \`${config.agent.workspaceDir}\``);
  }

  async _handleClear(msg) {
    const chatId = this._chatId(msg);
    const loop = this.activeLoops.get(chatId);
    if (loop) loop.brain?.reset();
    await this._send(chatId, '🧹 Context cleared.');
  }
}
