/**
 * telegram/bot.js
 * Telegram bot interface for ClawBot.
 * Handles commands, streams status updates, manages concurrent tasks.
 */

import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import os from 'os';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { AgentLoop } from '../agent/loop.js';
import { AgentMemory } from '../agent/memory.js';
import { Brain } from '../agent/brain.js';
import { WebSearch } from '../tools/search.js';
import { EmailTool } from '../tools/email.js';
import { Reporter } from '../tools/reporter.js';
import { IntentClassifier, INTENT } from '../agent/classifier.js';
import { Calculator } from '../tools/calculator.js';
import { CodeRunner } from '../tools/coderunner.js';
import { Reminder } from '../tools/reminder.js';
import { Calendar } from '../tools/calendar.js';
import { DailyBriefing } from '../tools/dailybriefing.js';
import { WeatherTool } from '../tools/weather.js';
import { Pomodoro } from '../tools/pomodoro.js';
import { HabitTracker } from '../tools/habits.js';
import { CryptoPriceTool } from '../tools/crypto.js';
import { WorldClock } from '../tools/worldclock.js';
import { VoiceNote } from '../tools/voicenote.js';
import { QRCodeTool } from '../tools/qrcode.js';
import { DevTools } from '../tools/devtools.js';
import { Automation } from '../tools/automation.js';
import { FileWatcher } from '../tools/filewatcher.js';
import { ChessGame } from '../tools/chess.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// Singleton classifier used across all messages
const classifier = new IntentClassifier();

/** Strip raw JSON blobs from messages before sending to Telegram */
function sanitize(text) {
  if (!text) return '';
  const trimmed = text.trim();

  // Case 1: entire message is a bare JSON object
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const j = JSON.parse(trimmed);
      if (j.params?.reply)   return j.params.reply;
      if (j.params?.summary) return j.params.summary;
      if (j.params?.message) return j.params.message;
      if (j.reply)           return j.reply;
      if (j.summary)         return j.summary;
    } catch { /* not valid JSON, fall through */ }
    // Still looks like JSON but we couldn't extract a reply — hide it
    return '';
  }

  // Case 2: message contains a ```json ... ``` block
  // Try to extract the reply field from inside first
  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const j = JSON.parse(fenceMatch[1].trim());
      const extracted = j.params?.reply || j.params?.summary || j.params?.message || j.reply || j.summary;
      if (extracted) return extracted;
    } catch { /* ignore */ }
    // Can't extract a clean reply — strip the block entirely
    const stripped = trimmed.replace(/```json[\s\S]*?```/gi, '').trim();
    return stripped || '';
  }

  // Case 3: message contains bare code fences with JSON-looking content
  const bareFence = trimmed.match(/```([\s\S]*?)```/);
  if (bareFence) {
    try {
      const j = JSON.parse(bareFence[1].trim());
      const extracted = j.params?.reply || j.params?.summary || j.reply || j.summary;
      if (extracted) return extracted;
    } catch { /* not JSON in the fence, leave it */ }
  }

  return text;
}

/**
 * Build an HTTPS agent that works behind Zscaler / corporate TLS-inspection proxies.
 * NODE_EXTRA_CA_CERTS (set in .env) makes Node trust the Zscaler Root CA,
 * so normal cert validation works without disabling security.
 * If HTTPS_PROXY / HTTP_PROXY is set, route through that proxy instead.
 */
function buildRequestAgent() {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY  ||
    process.env.http_proxy;

  if (proxyUrl) {
    logger.info(`[Telegram] Using proxy: ${proxyUrl}`);
    return new HttpsProxyAgent(proxyUrl);
  }

  // Zscaler performs TLS inspection on all outbound HTTPS connections.
  // rejectUnauthorized:false is scoped only to this agent (Telegram polling).
  return new https.Agent({ rejectUnauthorized: false, keepAlive: true });
}

export class ClawBotTelegram {
  constructor() {
    if (!config.telegram.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set in .env');
    }

    this._pollingRestartDelay = 5000; // ms, doubles on each consecutive failure
    this._pollingFailures = 0;

    const botOptions = {
      polling: {
        interval: 1000,
        autoStart: true,
        params: { timeout: 30 },
      },
      request: {
        agent: buildRequestAgent(),
        timeout: 60000,
      },
    };

    // Allow routing through a proxy worker (e.g. Cloudflare Worker) to bypass
    // corporate firewalls that block api.telegram.org directly.
    if (config.telegram.apiBaseUrl) {
      botOptions.baseApiUrl = config.telegram.apiBaseUrl;
      logger.info(`[Telegram] Using custom API base URL: ${config.telegram.apiBaseUrl}`);
    }

    this.bot = new TelegramBot(config.telegram.token, botOptions);
    this.memory = new AgentMemory();
    this.email = new EmailTool();
    this.reporter = new Reporter();
    this.calculator = new Calculator();
    this.codeRunner = new CodeRunner();
    this.reminderTool = new Reminder();
    this.calendarTool = new Calendar();
    this.briefingTool = new DailyBriefing();
    this.weatherTool  = new WeatherTool();
    this.pomodoroTool = new Pomodoro();
    this.habitsTool   = new HabitTracker();
    this.cryptoTool   = new CryptoPriceTool();
    this.worldClock   = new WorldClock();
    this.voiceNote    = new VoiceNote();
    this.qrCode       = new QRCodeTool();
    this.devTools     = new DevTools();
    this.automation   = new Automation();
    this.fileWatcher  = new FileWatcher();
    this.chessGame    = new ChessGame();
    this.activeLoops = new Map(); // chatId → AgentLoop
    this._registerHandlers();
    logger.info('[Telegram] Bot started and polling.');

    // Start background email monitor if configured
    if (config.email?.monitoring?.enabled) {
      this._startEmailMonitoring();
    }
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
    bot.onText(/\/email/, (msg) => this._handleEmail(msg));
    bot.onText(/\/report (.+)/, (msg, match) => this._handleReportRequest(msg, match[1].trim()));
    bot.onText(/\/reports/, (msg) => this._handleListReports(msg));
    bot.onText(/\/urgent/, (msg) => this._handleUrgentEmail(msg));
    bot.onText(/\/calc (.+)/, (msg, match) => this._handleCalc(msg, match[1].trim()));
    bot.onText(/\/run([\s\S]*)/, (msg, match) => this._handleRunCode(msg, (match[1] || '').trim()));
    bot.onText(/\/remind(?:er)?(.*)/, (msg, match) => this._handleRemind(msg, (match[1] || '').trim()));
    bot.onText(/\/me/, (msg) => this._handleMe(msg));
    bot.onText(/\/memory/, (msg) => this._handleMemoryView(msg));
    bot.onText(/\/today/, (msg) => this._handleToday(msg));
    bot.onText(/\/calendar(?:\s+(.*))?/, (msg, match) => this._handleCalendar(msg, (match[1] || '').trim()));
    bot.onText(/\/event(?:\s+(.*))?/, (msg, match) => this._handleAddEvent(msg, (match[1] || '').trim()));
    bot.onText(/\/send(?:\s+(.*))?/, (msg, match) => this._handleSendEmail(msg, (match[1] || '').trim()));
    // ─── New commands ─────────────────────────────────────────────
    bot.onText(/\/weather(?:\s+(.*))?/, (msg, match) => this._handleWeather(msg, (match[1] || '').trim()));
    bot.onText(/\/w(?:\s+(.*))?/, (msg, match) => this._handleWeather(msg, (match[1] || '').trim()));
    bot.onText(/\/pomo(?:\s+(.*))?/, (msg, match) => this._handlePomodoro(msg, (match[1] || '').trim()));
    bot.onText(/\/pomodoro(?:\s+(.*))?/, (msg, match) => this._handlePomodoro(msg, (match[1] || '').trim()));
    bot.onText(/\/habit(?:\s+(.*))?/, (msg, match) => this._handleHabits(msg, (match[1] || '').trim()));
    bot.onText(/\/habits/, (msg) => this._handleHabits(msg, ''));
    bot.onText(/\/crypto(?:\s+(.*))?/, (msg, match) => this._handleCrypto(msg, (match[1] || '').trim()));
    bot.onText(/\/price(?:\s+(.*))?/, (msg, match) => this._handleCrypto(msg, (match[1] || '').trim()));
    bot.onText(/\/stock(?:\s+(.*))?/, (msg, match) => this._handleCrypto(msg, (match[1] || '').trim()));
    bot.onText(/\/top(?:\s+(.*))?/, (msg, match) => this._handleCryptoTop(msg, (match[1] || '').trim()));
    bot.onText(/\/clock(?:\s+(.*))?/, (msg, match) => this._handleWorldClock(msg, (match[1] || '').trim()));
    bot.onText(/\/tz(?:\s+(.*))?/, (msg, match) => this._handleWorldClock(msg, (match[1] || '').trim()));
    bot.onText(/\/speak(?:\s+(.*))?/, (msg, match) => this._handleSpeak(msg, (match[1] || '').trim()));
    bot.onText(/\/say(?:\s+(.*))?/, (msg, match) => this._handleSpeak(msg, (match[1] || '').trim()));
    bot.onText(/\/qr(?:\s+(.*))?/, (msg, match) => this._handleQRCode(msg, (match[1] || '').trim()));
    bot.onText(/\/uuid/, (msg) => this._handleDevTool(msg, 'uuid'));
    bot.onText(/\/password(?:\s+(.*))?/, (msg, match) => this._handleDevTool(msg, 'password', match[1]?.trim()));
    bot.onText(/\/hash(?:\s+(.*))?/, (msg, match) => this._handleDevTool(msg, 'hash', match[1]?.trim()));
    bot.onText(/\/b64(?:\s+(.*))?/, (msg, match) => this._handleDevTool(msg, 'base64', match[1]?.trim()));
    bot.onText(/\/disk(?:\s+(.*))?/, (msg, match) => this._handleDisk(msg, (match[1] || '').trim()));
    bot.onText(/\/open(?:\s+(.+))/, (msg, match) => this._handleOpenApp(msg, match[1].trim()));
    bot.onText(/\/volume(?:\s+(.*))?/, (msg, match) => this._handleVolume(msg, (match[1] || '').trim()));
    bot.onText(/\/darkmode(?:\s+(.*))?/, (msg, match) => this._handleDarkMode(msg, (match[1] || '').trim()));
    bot.onText(/\/chess(?:\s+(.*))?/, (msg, match) => this._handleChessCommand(msg, (match[1] || '').trim()));
    bot.onText(/\/resign/, (msg) => this._handleChessResign(msg));
    bot.onText(/\/board/, (msg) => this._handleChessBoard(msg));

    bot.on('message', (msg) => {
      // Catch plain text (non-command) and route intelligently
      if (msg.text && !msg.text.startsWith('/')) {
        // ── If there is an active chess game, route ALL messages to it ─────────
        const chatId = this._chatId(msg);
        if (this.chessGame.hasGame(chatId)) {
          const text = msg.text.trim();
          if (/^(resign|quit|give up|i resign|surrender)$/i.test(text)) {
            const r = this.chessGame.resign(chatId);
            this._send(chatId, r.text).catch(() => {});
            return;
          }
          this._handleChessMove(msg, text);
          return;
        }
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
    const name = msg.from?.first_name || 'Boss';
    await this._send(chatId, [
      `👋 Hello *${name}*! I'm *ClawBot* – your personal AI assistant.`,
      ``,
      `Think of me as your Jarvis. I can:`,
      `🤔 Answer any question`,
      `💡 Brainstorm ideas`,
      `👨‍💻 Build, fix & deploy code`,
      `📄 Generate reports & documents`,
      `📧 Check your email & alert on urgent items`,
      `🔍 Research any topic`,
      `🖥️ Run terminal commands & automate tasks`,
      ``,
      `*Just type anything — I'll figure out what you need.*`,
      `Use /help to see all commands.`,
    ].join('\n'));

    this._rememberUser(msg);
  }

  async _handleHelp(msg) {
    const chatId = this._chatId(msg);
    const help = [
      `*🤖 ClawBot – Your Personal AI Assistant*`,
      ``,
      `*Just type anything!* I understand natural language.`,
      `You don't need commands for most things — just ask.`,
      ``,
      `*📋 Core Commands:*`,
      `\`/calc <expression>\` – Quick math & unit calc`,
      `\`/run <lang> <code>\` – Run Python/JS/bash snippet`,
      `\`/remind <time> <message>\` – Set a macOS reminder`,
      `\`/today\` – Daily briefing: calendar + email + reminders`,
      `\`/calendar\` – Show today's events`,
      `\`/event <time> <title>\` – Add a calendar event`,
      `\`/send <to> | <subject> | <body>\` – Send an email`,
      `\`/email\` – Check unread emails`,
      `\`/urgent\` – Show urgent emails`,
      `\`/report <topic>\` – Generate a report`,
      `\`/me\` – View your profile`,
      `\`/memory\` – View context`,
      `\`/task <text>\` – Run agent task`,
      `\`/stop\` – Stop running task`,
      `\`/status\` – Agent status`,
      `\`/history\` – Task history`,
      `\`/model <name>\` – Switch AI model`,
      `\`/models\` – List models`,
      `\`/clear\` – Clear context`,
      ``,
      `*🌦️ Weather:*`,
      `\`/weather [city]\` or \`/w [city]\` – Current weather + 3-day forecast`,
      ``,
      `*🍅 Pomodoro:*`,
      `\`/pomo start [task]\` – Start a 25-min focus session`,
      `\`/pomo pause|resume|stop|stats\` – Control timer`,
      ``,
      `*✅ Habits:*`,
      `\`/habit list\` – List all habits`,
      `\`/habit add <name>\` – Add a new habit`,
      `\`/habit done <name>\` – Check in today`,
      `\`/habit stats <name>\` – Show streaks & heatmap`,
      ``,
      `*💰 Crypto / Stocks:*`,
      `\`/crypto <coin>\` – Price for any coin (BTC, ETH, SOL...)`,
      `\`/stock <ticker>\` – Stock price (AAPL, TSLA...)`,
      `\`/top [n]\` – Top 10 cryptos by market cap`,
      ``,
      `*🌍 World Clock:*`,
      `\`/clock [city1, city2]\` – Current time in cities`,
      `\`/tz [cities]\` – Same as /clock`,
      ``,
      `*🔊 Voice / TTS:*`,
      `\`/speak <text>\` or \`/say <text>\` – Speak text on Mac`,
      ``,
      `*📷 QR Code:*`,
      `\`/qr <URL or text>\` – Generate a QR code PNG`,
      ``,
      `*💾 Disk / Files:*`,
      `\`/disk [path]\` – Disk usage overview`,
      ``,
      `*🛠️ Dev Tools:*`,
      `\`/uuid\` – Generate a UUID`,
      `\`/password [length]\` – Generate a secure password`,
      `\`/hash <text>\` – MD5/SHA hashes`,
      `\`/b64 <encode:text>\` or \`/b64 decode:<text>\` – Base64`,
      ``,
      `*🖥️ Automation:*`,
      `\`/open <AppName>\` – Open a macOS app`,
      `\`/volume [0-100]\` – Set volume (no arg = mute toggle)`,
      `\`/darkmode on|off\` – Toggle dark mode`,
      ``,
      `*♟️ Chess:*`,
      `\`/chess\` – Start a new chess game (you play White)`,
      `\`/chess black\` – Start as Black`,
      `\`/board\` – Show current board`,
      `\`/resign\` – Resign the game`,
      `_(During a game, just send your move: \`e4\`, \`Nf3\`, \`O-O\`, etc.)_`,
      ``,
      `*💬 Natural language examples:*`,
      `• \`What's the weather in Tokyo?\``,
      `• \`BTC price\``,
      `• \`Start a pomodoro for coding\``,
      `• \`I did my workout today\``,
      `• \`What time is it in London?\``,
      `• \`Generate QR for https://example.com\``,
      `• \`What are the largest files on my Desktop?\``,
      `• \`Open Xcode\``,
    ].join('\n');
    await this._send(chatId, help);
  }

  async _handleTask(msg, task) {
    const chatId = this._chatId(msg);

    if (!this._isAuthorized(msg)) {
      await this._send(chatId, '⛔ Unauthorized. Your user ID is not in the allowed list.');
      return;
    }

    logger.section(`INCOMING MESSAGE`);
    logger.info(`[Bot] From    : ${msg.from?.first_name} (id: ${msg.from?.id})`);
    logger.info(`[Bot] Message : "${task.slice(0, 120)}"`);

    // ── Load user context (profile + conversation history) ───────────────────
    const userId = msg.from?.id;
    const userName = msg.from?.first_name || 'Boss';
    let userProfile = {};
    let convoHistory = [];
    if (userId) {
      userProfile = (await this.memory.getUserProfile(userId)) || {};
      if (!userProfile.name) {
        await this.memory.updateUserProfile(userId, { name: userName, username: msg.from?.username });
        userProfile.name = userName;
      }
      convoHistory = await this.memory.getConversationHistory(userId, 12);
      await this.memory.addConversationMessage(userId, 'user', task);
    }

    // ── Instant answers (no Ollama call needed) ─────────────────────────────
    const instantReply = this._instantAnswer(task, userProfile);
    if (instantReply) {
      logger.info(`[Bot] Instant answer: "${instantReply.slice(0, 60)}"`);
      await this._send(chatId, instantReply);
      if (userId) await this.memory.addConversationMessage(userId, 'assistant', instantReply);
      return;
    }

    // ── Fast tool dispatch — bypass Ollama entirely for recognisable requests ─
    // Runs before the classifier so QR, weather, crypto etc. never hit the loop.
    const fastResult = await this._fastToolDispatch(task, chatId);
    if (fastResult) {
      if (userId) await this.memory.addConversationMessage(userId, 'assistant', fastResult);
      return;
    }

    // ── Smart intent routing ─────────────────────────────────────────────────
    const intent = classifier.classify(task);
    logger.info(`[Bot] Intent  : ${intent.toUpperCase()}`);

    // Conversational → quickReply (no loop)
    if (intent === INTENT.CONVERSATIONAL) {
      logger.info('[Bot] Route → quickReply (conversational)');
      const stopTyping = this._startTyping(chatId);
      try {
        const brain = new Brain();
        brain.setUserContext(userProfile, convoHistory);
        const search = new WebSearch();
        const result = await brain.quickReply(task, { search, calculator: this.calculator });
        logger.debug(`[Bot] quickReply result: usedLoop=${result.usedLoop} | text="${(result.text || '').slice(0, 80)}"`);
        if (!result.usedLoop) {
          const reply = sanitize(result.text);
          logger.info(`[Bot] Sending reply: "${reply.slice(0, 80)}"`);
          await this._send(chatId, reply || '🤖 How can I help?');
          if (userId) await this.memory.addConversationMessage(userId, 'assistant', reply);
          return;
        }
        logger.info('[Bot] quickReply deferred to full loop');
        // Brain decided it needs tools – fall through to full loop
      } catch (err) {
        logger.error(`[Bot] quickReply error: ${err.message}`);
        await this._send(chatId, `❌ ${err.message}`);
        return;
      } finally {
        stopTyping();
      }
    }

    // Questions → try quickReply first; only use loop if tools are needed
    if (intent === INTENT.QUESTION) {
      logger.info('[Bot] Route → quickReply (question)');
      const stopTypingQ = this._startTyping(chatId);
      try {
        const brain = new Brain();
        brain.setUserContext(userProfile, convoHistory);
        const search = new WebSearch();
        const result = await brain.quickReply(task, { search, calculator: this.calculator });
        logger.debug(`[Bot] quickReply result: usedLoop=${result.usedLoop} | text="${(result.text || '').slice(0, 80)}"`);
        if (!result.usedLoop) {
          const reply = sanitize(result.text);
          logger.info(`[Bot] Sending answer: "${reply.slice(0, 80)}"`);
          await this._send(chatId, reply || '🤖 Could not find an answer.');
          if (userId) await this.memory.addConversationMessage(userId, 'assistant', reply);
          return;
        }
        logger.info('[Bot] Question needs tools → forwarding to full loop');
      } catch (err) {
        logger.error(`[Bot] Question quickReply error: ${err.message}`);
        await this._send(chatId, `❌ ${err.message}`);
        return;
      } finally {
        stopTypingQ();
      }
    }

    // Email → handle directly
    if (intent === INTENT.EMAIL) {
      logger.info('[Bot] Route → email handler');
      await this._handleEmailQuery(chatId, task);
      return;
    }

    // Reminder / notification → handle directly without full loop
    if (this._isReminderTask(task)) {
      logger.info('[Bot] Route → reminder handler');
      const stopTypingR = this._startTyping(chatId);
      try {
        const result = await this._handleReminderTask(task);
        await this._send(chatId, result);
        if (userId) await this.memory.addConversationMessage(userId, 'assistant', result);
      } catch (err) {
        await this._send(chatId, `❌ Reminder error: ${err.message}`);
      } finally {
        stopTypingR();
      }
      return;
    }

    // Calendar → handle directly
    if (this._isCalendarTask(task)) {
      logger.info('[Bot] Route → calendar handler');
      const stopTypingC = this._startTyping(chatId);
      try {
        const result = await this._handleCalendarTask(task);
        await this._send(chatId, result);
        if (userId) await this.memory.addConversationMessage(userId, 'assistant', result);
      } catch (err) {
        await this._send(chatId, `❌ Calendar error: ${err.message}`);
      } finally {
        stopTypingC();
      }
      return;
    }

    // Daily briefing → handle directly
    if (this._isBriefingTask(task)) {
      logger.info('[Bot] Route → briefing handler');
      const stopTypingBr = this._startTyping(chatId);
      try {
        await this._send(chatId, '📋 Generating your daily briefing…');
        const result = await this.briefingTool.generate({});
        await this._send(chatId, result);
        if (userId) await this.memory.addConversationMessage(userId, 'assistant', result);
      } catch (err) {
        await this._send(chatId, `❌ Briefing error: ${err.message}`);
      } finally {
        stopTypingBr();
      }
      return;
    }

    // Brainstorm → quickReply (brain uses brainstorm action)
    if (intent === INTENT.BRAINSTORM) {
      logger.info('[Bot] Route → quickReply (brainstorm)');
      const stopTypingB = this._startTyping(chatId);
      try {
        const brain = new Brain();
        brain.setUserContext(userProfile, convoHistory);
        const result = await brain.quickReply(task, { calculator: this.calculator });
        logger.debug(`[Bot] brainstorm result: usedLoop=${result.usedLoop}`);
        if (!result.usedLoop) {
          const reply = sanitize(result.text);
          logger.info(`[Bot] Sending brainstorm reply (${reply.length} chars)`);
          await this._send(chatId, reply || '💡 Here are some ideas…');
          if (userId) await this.memory.addConversationMessage(userId, 'assistant', reply);
          return;
        }
      } catch (err) {
        logger.error(`[Bot] Brainstorm error: ${err.message}`);
        await this._send(chatId, `❌ ${err.message}`);
        return;
      } finally {
        stopTypingB();
      }
    }

    // Everything else (including report, task, fallthrough) → full agent loop
    logger.info(`[Bot] Route → full agent loop`);

    if (this.activeLoops.has(chatId)) {
      await this._send(chatId, '⚠️ A task is already running. Use /stop to cancel it first.');
      return;
    }

    const workDir = path.join(config.agent.workspaceDir, `session_${chatId}`);

    // Status updater: rate-limited to avoid Telegram flood limits (1 msg / 700ms),
    // but never drops messages – queues and drains them sequentially.
    let lastMsgId = null;
    const msgQueue = [];
    let draining = false;

    const drainQueue = async () => {
      if (draining) return;
      draining = true;
      while (msgQueue.length > 0) {
        const text = msgQueue.shift();
        try {
          const sent = await this._send(chatId, text);
          if (sent) lastMsgId = sent.message_id;
        } catch (_) { /* non-fatal */ }
        // Respect Telegram rate limits
        await new Promise((r) => setTimeout(r, 700));
      }
      draining = false;
    };

    const onStatusUpdate = async (text) => {
      const safe = sanitize(text);
      if (!safe) return; // filtered out (was raw JSON)
      msgQueue.push(safe);
      drainQueue(); // fire-and-forget drain
    };

    const loop = new AgentLoop({ onStatusUpdate });
    loop.setUserContext(userProfile, convoHistory);
    this.activeLoops.set(chatId, loop);

    await this._send(chatId, `🚀 Starting task:\n*${task}*`);

    let taskResult = null;
    try {
      taskResult = await loop.run(task, workDir);
      // Wait for any queued status messages to drain before sending final result
      await new Promise((r) => setTimeout(r, 800));
      while (draining || msgQueue.length > 0) {
        await new Promise((r) => setTimeout(r, 300));
      }

      logger.section(`TASK FINISHED`);
      logger.info(`[Bot] Success: ${taskResult.success} | Steps: ${taskResult.steps}`);
      logger.info(`[Bot] Summary: ${taskResult.summary?.slice(0, 120)}`);

      const icon = taskResult.success ? '✅' : '❌';
      await this._send(
        chatId,
        `${icon} *Task finished* (${taskResult.steps} steps)\n\n${sanitize(taskResult.summary)}`
      );
    } catch (err) {
      logger.error(`[Bot] Fatal task error: ${err.message}`);
      logger.error(`[Bot] Stack: ${err.stack}`);
      await this._send(chatId, `💥 Fatal error: ${err.message}`);
    } finally {
      this.activeLoops.delete(chatId);
      if (userId && taskResult) {
        const summary = taskResult.summary || '';
        if (summary) await this.memory.addConversationMessage(userId, 'assistant', summary);
        await this.memory.learnFromTask(userId, task, summary);
      }
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

  async _handleEmail(msg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    await this._send(chatId, '📬 Checking your inbox…');
    try {
      const result = await this.email.checkEmail({ filter: 'unread', limit: 15, sinceDays: 7 });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Email check failed: ${err.message}`);
    }
  }

  async _handleUrgentEmail(msg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    await this._send(chatId, '🚨 Scanning for urgent emails…');
    try {
      const result = await this.email.checkEmail({ filter: 'urgent', limit: 20, sinceDays: 3 });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Email check failed: ${err.message}`);
    }
  }

  async _handleEmailQuery(chatId, task) {
    const lower = task.toLowerCase();
    const filter = lower.includes('urgent') || lower.includes('important') ? 'urgent' : 'unread';
    await this._send(chatId, filter === 'urgent' ? '🚨 Scanning for urgent emails…' : '📬 Checking your inbox…');
    try {
      const result = await this.email.checkEmail({ filter, limit: 15, sinceDays: 7 });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Email check failed: ${err.message}`);
    }
  }

  _isReminderTask(task) {
    const t = task.toLowerCase();
    return /\b(set\s+(a\s+)?reminder|create\s+(a\s+)?reminder|add\s+(a\s+)?reminder|remind\s+me|alert\s+me|notify\s+me|ping\s+me)\b/.test(t) ||
           /\b(reminder|notification)\b.*\b(at|for|in)\s+\d/.test(t) ||
           /\b(set|schedule)\s+(an?\s+)?(alarm|alert|notification)\b/.test(t);
  }

  _isCalendarTask(task) {
    const t = task.toLowerCase();
    return /\b(my\s+schedule|what'?s?\s+on\s+today|what'?s?\s+on\s+my\s+calendar|show\s+(my\s+)?calendar|today'?s?\s+(events?|meetings?|schedule)|week\s+ahead|this\s+week'?s?\s+schedule)\b/.test(t) ||
           /\b(add\s+(a\s+)?(meeting|event|appointment)|schedule\s+(a\s+)?(meeting|call|event)|create\s+(a\s+)?(meeting|event)|new\s+(meeting|event|appointment))\b/.test(t) ||
           /\b(cancel\s+(meeting|event)|delete\s+(meeting|event)|remove\s+(meeting|event))\b/.test(t) ||
           /\b(what meetings?|any (meetings?|events?)|upcoming (meetings?|events?))\b/.test(t);
  }

  async _handleCalendarTask(task) {
    const t = task.toLowerCase();
    // Create/add event
    if (/\b(add|schedule|create|new)\s+(a\s+)?(meeting|event|appointment|call)\b/.test(t)) {
      // Extract time and title from the task
      const timeRx = /\b((?:today|tomorrow|next\s+\w+|\w+day)\s+(?:at\s+)?)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i;
      const tMatch = task.match(timeRx);
      const time = tMatch ? tMatch[0].trim() : '';
      // Title = what's left after removing scheduling keywords and time
      let title = task
        .replace(/\b(add|schedule|create|new|set up|book)\s+(a\s+)?(meeting|call|event|appointment)\s*(for|at|on)?\s*/gi, '')
        .replace(/\b(today|tomorrow|next\s+\w+|\w+day)\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*/gi, '')
        .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*/gi, '')
        .trim() || 'Meeting';
      return await this.calendarTool.createEvent({ title, time });
    }
    // Delete event
    if (/\b(cancel|delete|remove)\s+(meeting|event)\b/.test(t)) {
      const m = task.match(/\b(cancel|delete|remove)\s+(?:the\s+)?(?:meeting|event)?\s+"?([^"]+)"?/i);
      const query = m ? m[2].trim() : task;
      return await this.calendarTool.deleteEvent({ query });
    }
    // Week view
    if (/\b(this\s+week|week\s+ahead|week'?s?\s+schedule)\b/.test(t)) {
      return await this.calendarTool.getWeekEvents();
    }
    // Default: today
    return await this.calendarTool.getTodayEvents();
  }

  _isBriefingTask(task) {
    const t = task.toLowerCase();
    return /\b(daily\s+briefing|morning\s+(briefing|summary|rundown)|briefing|day\s+ahead|what'?s?\s+(on|planned)\s+(for\s+)?today|today'?s?\s+briefing|my\s+day)\b/.test(t);
  }

  async _handleReminderTask(task) {
    // Extract time and message from natural language
    // e.g. "Create a reminder for today at 6:35pm for daily status mail"
    //      "Remind me at 9am to check email"
    //      "Set a reminder in 30 minutes to review the PR"
    const t = task;

    // Extract time
    const timePatterns = [
      /\bat\s+(\d{1,2}:\d{2}\s*(?:am|pm)?)/i,
      /\bat\s+(\d{1,2}\s*(?:am|pm))/i,
      /\b(in\s+\d+\s+(?:minutes?|mins?|hours?|hrs?|seconds?|secs?))\b/i,
      /\bfor\s+(?:today\s+)?at\s+(\d{1,2}:\d{2}\s*(?:am|pm)?)/i,
    ];

    let time = '';
    for (const pat of timePatterns) {
      const m = t.match(pat);
      if (m) { time = m[1].trim(); break; }
    }

    // Extract message: strip reminder trigger words + time expression
    let message = t
      .replace(/\b(create|set|add|make|schedule)\s+(a\s+)?reminder\s+(for\s+)?(today\s+)?/gi, '')
      .replace(/\b(remind\s+me|alert\s+me|notify\s+me|ping\s+me)\s*/gi, '')
      .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s*/gi, '')
      .replace(/\bfor\s+today\s*/gi, '')
      .replace(/\bin\s+\d+\s+(?:minutes?|hours?|seconds?)\s*/gi, '')
      .replace(/^(about|to|for|regarding)\s+/i, '')
      .trim();

    if (!message) message = task;

    const result = await this.reminderTool.create({ text: message, time });
    return result || `✅ Reminder set: "${message}"${time ? ` at ${time}` : ''}`;
  }

  async _handleReportRequest(msg, topic) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    // Route through the full loop so the brain can research + write the report
    await this._handleTask(msg, `Generate a detailed report on: ${topic}`);
  }

  async _handleListReports(msg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    await this._send(chatId, this.reporter.listReports());
  }

  _rememberUser(msg) {
    const userId = msg.from?.id;
    if (!userId) return;
    const updates = { lastSeen: Date.now() };
    if (msg.from?.first_name) updates.name = msg.from.first_name;
    if (msg.from?.username) updates.username = msg.from.username;
    try { this.memory.updateUserProfile(userId, updates); } catch (_) {}
  }

  /**
   * Return an instant answer string for trivial queries that don't need Ollama.
   * Returns null if Ollama should handle the request.
   */
  // ─────────────────────────────────────────────
  // Fast tool dispatch (no Ollama)
  // ─────────────────────────────────────────────

  /**
   * Pattern-match common tool requests and run them directly,
   * completely bypassing the LLM classifier + agent loop.
   * Returns the reply string if handled, null otherwise.
   */
  async _fastToolDispatch(task, chatId) {
    const t = task.trim();
    const tl = t.toLowerCase();

    // ── Chess game request ────────────────────────────────────────────────
    if (/\bchess\b/i.test(tl) || /\bplay.*game\b/i.test(tl)) {
      logger.info(`[Bot] Fast dispatch → chess (new game request)`);
      const colorMatch = tl.match(/\b(black|white)\b/i);
      const color = colorMatch ? colorMatch[1][0].toLowerCase() : 'w';
      const res = this.chessGame.start(chatId, color);
      await this._send(chatId, res.text);
      return res.text;
    }

    // ── QR code ───────────────────────────────────────────────────────────
    const qrMatch = tl.match(/(?:generate|create|make|build|give me|produce)?\s*(?:a\s+)?qr\s*(?:code)?\s+(?:for\s+)?(.+)/i)
      || (tl.includes('qr') && t.match(/https?:\/\/\S+/));
    if (qrMatch) {
      // Extract the URL or text: prefer a URL found in the original task
      const urlMatch = t.match(/https?:\/\/\S+/);
      const text = urlMatch ? urlMatch[0] : (typeof qrMatch[1] === 'string' ? qrMatch[1].trim() : t);
      if (text && text.length > 3) {
        logger.info(`[Bot] Fast dispatch → QR code: "${text.slice(0, 60)}"`);
        const stop = this._startTyping(chatId);
        try {
          const result = await this.qrCode.generate({ text });
          await this._send(chatId, result);
          return result;
        } catch (err) {
          const msg = `❌ QR code error: ${err.message}`;
          await this._send(chatId, msg);
          return msg;
        } finally {
          stop();
        }
      }
    }

    // ── Weather ───────────────────────────────────────────────────────────
    if (/weather|forecast|temperature|humidity|rain|sunny|cloudy/i.test(tl)) {
      // Extract city name: "weather in Tokyo", "what's the weather Tokyo"
      const cityMatch = t.match(/(?:weather|forecast)(?:\s+in|\s+for|\s+at)?\s+([A-Za-z\s,]+?)(?:\s*\?|$)/i);
      const city = cityMatch ? cityMatch[1].trim() : 'Mumbai';
      logger.info(`[Bot] Fast dispatch → weather: "${city}"`);
      const stop = this._startTyping(chatId);
      try {
        const result = await this.weatherTool.getWeather({ location: city });
        await this._send(chatId, result);
        return result;
      } catch (err) {
        const msg = `❌ Weather error: ${err.message}`;
        await this._send(chatId, msg);
        return msg;
      } finally {
        stop();
      }
    }

    // ── Crypto / Stock price ──────────────────────────────────────────────
    const cryptoMatch = tl.match(/(?:price|value|cost|rate|worth|how much is|check)\s+(?:of\s+)?([A-Za-z]+)/) ||
      tl.match(/([A-Za-z]+)\s+(?:price|value|rate|coin|crypto|token|stock)/) ||
      tl.match(/^(?:btc|eth|sol|xrp|ada|dot|avax|bnb|matic|doge|shib|aapl|tsla|msft|googl|amzn|meta|nvda)[\s$]?$/i);
    if (cryptoMatch) {
      const coin = (cryptoMatch[1] || cryptoMatch[0]).trim().toUpperCase();
      logger.info(`[Bot] Fast dispatch → crypto: "${coin}"`);
      const stop = this._startTyping(chatId);
      try {
        const result = await this.cryptoTool.price({ coin });
        await this._send(chatId, result);
        return result;
      } catch (err) {
        const msg = `❌ Price error: ${err.message}`;
        await this._send(chatId, msg);
        return msg;
      } finally {
        stop();
      }
    }

    // ── World clock ───────────────────────────────────────────────────────
    if (/what time is it in|current time in|time in|clock in|time (?:at|for)/i.test(tl)) {
      const cityMatch = t.match(/(?:time is it in|time in|current time in|clock in|time (?:at|for))\s+([A-Za-z\s,]+?)(?:\s*\?|$)/i);
      const cities = cityMatch ? cityMatch[1].split(',').map(c => c.trim()) : ['Mumbai', 'London', 'New York'];
      logger.info(`[Bot] Fast dispatch → world clock: ${cities.join(', ')}`);
      const stop = this._startTyping(chatId);
      try {
        const result = await this.worldClock.now({ cities });
        await this._send(chatId, result);
        return result;
      } catch (err) {
        const msg = `❌ Clock error: ${err.message}`;
        await this._send(chatId, msg);
        return msg;
      } finally {
        stop();
      }
    }

    // ── Pomodoro ──────────────────────────────────────────────────────────
    if (/pomodoro|pomo|focus (timer|session|mode)|start.*focus|start.*timer/i.test(tl)) {
      const taskName = t.replace(/.*(?:pomodoro|pomo|focus timer|focus session|focus mode|start\s+focus|start\s+timer)\s*/i, '').trim() || 'Focus session';
      logger.info(`[Bot] Fast dispatch → pomodoro start: "${taskName}"`);
      const stop = this._startTyping(chatId);
      try {
        const result = await this.pomodoroTool.start({ task: taskName });
        await this._send(chatId, result);
        return result;
      } catch (err) {
        const msg = `❌ Pomodoro error: ${err.message}`;
        await this._send(chatId, msg);
        return msg;
      } finally {
        stop();
      }
    }

    // ── TTS / speak ───────────────────────────────────────────────────────
    if (/^(?:say|speak|read(?:\s+out)?(?:\s+loud)?|tell mac to say)\s+/i.test(tl)) {
      const text = t.replace(/^(?:say|speak|read(?:\s+out)?(?:\s+loud)?|tell mac to say)\s+/i, '').trim();
      if (text) {
        logger.info(`[Bot] Fast dispatch → speak: "${text.slice(0, 40)}"`);
        const stop = this._startTyping(chatId);
        try {
          const result = await this.voiceNote.speak({ text });
          await this._send(chatId, result);
          return result;
        } catch (err) {
          const msg = `❌ TTS error: ${err.message}`;
          await this._send(chatId, msg);
          return msg;
        } finally {
          stop();
        }
      }
    }

    // ── Open app ──────────────────────────────────────────────────────────
    if (/^(?:open|launch|start)\s+([A-Za-z\s]+?)(?:\s*(?:app|application))?\s*$/i.test(t)) {
      const appMatch = t.match(/^(?:open|launch|start)\s+([A-Za-z\s]+?)(?:\s*(?:app|application))?\s*$/i);
      const appName = appMatch ? appMatch[1].trim() : '';
      if (appName && appName.length > 1) {
        logger.info(`[Bot] Fast dispatch → open app: "${appName}"`);
        const stop = this._startTyping(chatId);
        try {
          const result = await this.automation.openApp({ name: appName });
          await this._send(chatId, result);
          return result;
        } catch (err) {
          const msg = `❌ Could not open app: ${err.message}`;
          await this._send(chatId, msg);
          return msg;
        } finally {
          stop();
        }
      }
    }

    return null; // nothing matched — let normal routing handle it
  }

  // ─────────────────────────────────────────────
  // Instant answers (zero-latency, no LLM)
  // ─────────────────────────────────────────────
  _instantAnswer(task, userProfile) {
    const t = task.trim().toLowerCase().replace(/[?!.]+$/, '').trim();
    const name = userProfile?.name || 'Boss';

    // Time / date
    if (/^(what('s| is) (the )?(current |local )?(time|clock))/.test(t) ||
        /^(what time is it|current time|tell me the time|time now)/.test(t)) {
      return `🕐 The current time on this machine is *${new Date().toLocaleTimeString()}*`;
    }
    if (/^(what('s| is) (today'?s? )?(date|day))/.test(t) ||
        /^(today'?s? date|what day is it|what is the date today)/.test(t)) {
      return `📅 Today is *${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}*`;
    }

    // Identity — who built / made / created you
    if (/^(who are you|what are you|what'?s your name|your name)/.test(t)) {
      return `🤖 I'm *ClawBot* — your personal JARVIS-style AI assistant built by *Prem*.\n\nI can:\n• Check weather, crypto prices & world clocks\n• Set reminders & calendar events\n• Control your Mac (volume, dark mode, apps)\n• Run code & terminal commands\n• Browse the web & check emails\n• Generate QR codes, track habits, run Pomodoro timers\n\nJust type anything — I'll figure out what you need, ${name}!`;
    }
    if (/^(who (built|made|created|developed) you|who('?s| is) your (creator|developer|author|maker))/.test(t)) {
      return `🤖 I was built by *Prem* — your personal AI assistant running locally on your Mac. I'm powered by Ollama with a locally-hosted LLM.`;
    }

    // Capabilities
    if (/^(what can you do|what are your (capabilities|features|skills|powers))$/.test(t)) {
      return `Here's what I can do, ${name}! Type \`/help\` for the full command list, or just ask me naturally:\n\n🌦 Weather • 💰 Crypto & stocks • 🌍 World clocks\n🍅 Pomodoro • ✅ Habits • 📷 QR codes • 🔊 TTS\n📅 Calendar • ⏰ Reminders • 📧 Email\n💻 Run code • 🔍 Web search • 🖥️ Mac automation\n🛠️ Dev tools (UUID, hash, base64…) • 💾 Disk analysis`;
    }

    // Gratitude / acknowledgement — no need to bother Ollama
    if (/^(thanks|thank you|thx|ty|cheers|appreciate it|great|awesome|perfect|nice|cool|good job|well done|excellent|amazing|incredible|brilliant|fantastic|superb|wonderful|love it)[\s!.]*$/.test(t)) {
      return `You're welcome, ${name}! 😊 Anything else I can help with?`;
    }
    if (/^(ok|okay|got it|understood|sure|noted|sounds good|alright|roger|copy that|makes sense)[\s!.]*$/.test(t)) {
      return `Got it, ${name}! Let me know if you need anything else.`;
    }
    if (/^(bye|goodbye|see you|later|cya|good night|gn|peace out)[\s!.]*$/.test(t)) {
      return `See you later, ${name}! 👋 I'll be here whenever you need me.`;
    }
    if (/^(yes|no|yep|nope|yeah|nah|yup)[\s!.]*$/.test(t)) {
      return `Got it! Let me know if there's anything you'd like to do.`;
    }

    // Self-awareness / status
    if (/^(are you (there|online|alive|working|running)|you there|you alive)/.test(t)) {
      return `✅ I'm online and ready, ${name}! What can I do for you?`;
    }
    if (/^(how are you|how'?s it going|how do you do)[\s!.?]*$/.test(t)) {
      return `I'm running great, ${name}! All systems operational. What do you need? 🚀`;
    }

    // Profile
    if (/^(what'?s my name|who am i)/.test(t)) {
      return `Your name is *${name}*! I remember you. 😊`;
    }

    // Greetings
    const greetRegex = /^(hi+|hey+|hello+|hola|howdy|yo+|sup+|hiya|good (morning|afternoon|evening|night))[\s!.]*$/i;
    if (greetRegex.test(task.trim())) {
      const hour = new Date().getHours();
      const timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      return `${timeGreet}, *${name}*! 👋 What can I do for you today?`;
    }

    return null; // Ollama handles everything else
  }

  // ─────────────────────────────────────────────
  // Typing indicator helper
  // ─────────────────────────────────────────────

  /**
   * Start sending "typing" action to Telegram every 4s.
   * Returns a stop() function — always call it when done.
   * Telegram typing indicator expires after ~5 seconds, so we refresh.
   */
  _startTyping(chatId) {
    let active = true;
    const send = () => {
      if (!active) return;
      this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    };
    send();
    const interval = setInterval(send, 4000);
    return () => { active = false; clearInterval(interval); };
  }

  // ─────────────────────────────────────────────
  // New capability handlers
  // ─────────────────────────────────────────────

  async _handleRemind(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!text) {
      await this._send(chatId, [
        'Usage: `/remind <time> <message>`',
        '',
        'Examples:',
        '• `/remind 6:35pm daily status mail`',
        '• `/remind in 30 minutes check the build`',
        '• `/remind 9:00am tomorrow standup call`',
      ].join('\n'));
      return;
    }
    // Parse leading time: "6:35pm ...", "18:35 ...", "in X minutes ..."
    const timeMatch = text.match(/^(\d{1,2}:\d{2}(?:\s*[ap]m)?|in\s+\d+\s+(?:minute|min|hour|hr|second|sec)s?)\s+(.*)/i);
    let time = '';
    let message = text;
    if (timeMatch) {
      time = timeMatch[1].trim();
      message = timeMatch[2].trim();
    }
    const stopTyping = this._startTyping(chatId);
    try {
      const result = await this.reminderTool.create({ text: message || text, time });
      await this._send(chatId, result || '✅ Reminder set!');
    } catch (err) {
      await this._send(chatId, `❌ Could not set reminder: ${err.message}`);
    } finally {
      stopTyping();
    }
  }

  async _handleCalc(msg, expr) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!expr) {
      await this._send(chatId, 'Usage: `/calc <expression>`\nExamples:\n• `/calc 2 + 2`\n• `/calc 5 km to miles`\n• `/calc sqrt(144)`');
      return;
    }
    try {
      const result = this.calculator.calculate({ expression: expr });
      await this._send(chatId, `🧮 \`${expr}\`\n= *${result}*`);
    } catch (err) {
      await this._send(chatId, `❌ Calculation error: ${err.message}`);
    }
  }

  async _handleRunCode(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!text) {
      await this._send(chatId, 'Usage: `/run <lang> <code>`\nExamples:\n• `/run python print("Hello, Boss")`\n• `/run js console.log(2 ** 10)`\n• `/run bash echo $HOME`');
      return;
    }
    // First word = language, rest = code
    const spaceIdx = text.indexOf(' ');
    if (spaceIdx === -1) {
      await this._send(chatId, '❌ Provide both a language and code.\nExample: `/run python print(42)`');
      return;
    }
    const lang = text.slice(0, spaceIdx).toLowerCase();
    const code = text.slice(spaceIdx + 1).trim();
    await this._send(chatId, `⚙️ Running *${lang}* snippet…`);
    try {
      const output = await this.codeRunner.run({ language: lang, code });
      const safe = (output || '(no output)').slice(0, 3500);
      await this._send(chatId, `\`\`\`\n${safe}\n\`\`\``);
    } catch (err) {
      await this._send(chatId, `❌ Run error: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // Daily Briefing: /today
  // ─────────────────────────────────────────────

  async _handleToday(msg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stopTyping = this._startTyping(chatId);
    try {
      await this._send(chatId, '📋 Generating your daily briefing…');
      const result = await this.briefingTool.generate({});
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Briefing failed: ${err.message}`);
    } finally {
      stopTyping();
    }
  }

  // ─────────────────────────────────────────────
  // Calendar: /calendar [week|query]
  // ─────────────────────────────────────────────

  async _handleCalendar(msg, arg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stopTyping = this._startTyping(chatId);
    try {
      let result;
      if (arg === 'week' || arg === 'this week' || arg === 'week ahead') {
        result = await this.calendarTool.getWeekEvents();
      } else if (arg) {
        result = await this.calendarTool.findEvent({ query: arg });
      } else {
        result = await this.calendarTool.getTodayEvents();
      }
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Calendar error: ${err.message}`);
    } finally {
      stopTyping();
    }
  }

  // ─────────────────────────────────────────────
  // Add event: /event <time> <title>
  // e.g. /event tomorrow 3pm Team Standup
  // ─────────────────────────────────────────────

  async _handleAddEvent(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!text) {
      await this._send(chatId, [
        'Usage: `/event <time> <title>`',
        '',
        'Examples:',
        '• `/event tomorrow 3pm Team standup`',
        '• `/event Friday 10am Doctor appointment`',
        '• `/event 25 Jan 2pm Project review`',
      ].join('\n'));
      return;
    }
    const stopTyping = this._startTyping(chatId);
    try {
      // Use Reminder's parser to pull out the time portion
      const R = this.reminderTool;
      // Try to find time prefix in the text
      const timeRx = /^((?:in\s+\d+\s+(?:min|minute|hour|hr)s?|(?:today|tomorrow|yesterday|next\s+\w+|\d{1,2}\s+\w+|\w+day)\s*)?(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\s+(.*)/i;
      const m = text.match(timeRx);
      let time = '', title = text;
      if (m) { time = m[1].trim(); title = m[2].trim(); }
      const result = await this.calendarTool.createEvent({ title, time, duration: 60 });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Could not create event: ${err.message}`);
    } finally {
      stopTyping();
    }
  }

  // ─────────────────────────────────────────────
  // Send email: /send to@email.com | Subject | Body text
  // ─────────────────────────────────────────────

  async _handleSendEmail(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!text) {
      await this._send(chatId, [
        'Usage: `/send <to> | <subject> | <body>`',
        '',
        'Example:',
        '• `/send boss@company.com | Weekly Update | Hi, attaching this week\'s report.`',
      ].join('\n'));
      return;
    }
    const parts = text.split('|').map(s => s.trim());
    if (parts.length < 3) {
      await this._send(chatId, '⚠️ Please use the format: `to | subject | body`\n\nExample: `/send alice@example.com | Hello | How are you?`');
      return;
    }
    const [to, subject, ...bodyParts] = parts;
    const body = bodyParts.join(' | ');
    const stopTyping = this._startTyping(chatId);
    try {
      const result = await this.email.sendEmail({ to, subject, body });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Send failed: ${err.message}`);
    } finally {
      stopTyping();
    }
  }

  async _handleMe(msg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const userId = msg.from?.id;
    if (!userId) { await this._send(chatId, '❌ No user ID found.'); return; }
    const profile = (await this.memory.getUserProfile(userId)) || {};
    const projects = (profile.knownProjects || []).join(', ') || 'none detected yet';
    const prefs = profile.preferences ? `\`${JSON.stringify(profile.preferences)}\`` : 'none';
    const lines = [
      `*👤 Your Profile*`,
      ``,
      `Name: *${profile.name || 'Unknown'}*`,
      `Username: @${profile.username || '?'}`,
      `Tasks completed: ${profile.tasksCompleted || 0}`,
      `Known projects: ${projects}`,
      `Preferences: ${prefs}`,
      `Last seen: ${profile.lastSeen ? new Date(profile.lastSeen).toLocaleString() : 'never'}`,
    ];
    await this._send(chatId, lines.join('\n'));
  }

  async _handleMemoryView(msg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const userId = msg.from?.id;
    if (!userId) { await this._send(chatId, '❌ No user ID found.'); return; }
    const history = await this.memory.getConversationHistory(userId, 10);
    if (!history.length) {
      await this._send(chatId, 'ℹ️ No conversation memory yet. Chat with me to build it up!');
      return;
    }
    const icon = { user: '🧑', assistant: '🤖' };
    const lines = history.map(
      (m, i) => `${icon[m.role] || '•'} *${m.role}*: ${m.content.slice(0, 100)}${m.content.length > 100 ? '…' : ''}`
    );
    await this._send(chatId, `*🧠 Conversation Memory (last ${history.length}):*\n\n${lines.join('\n')}`);
  }

  /**
   * Background email monitor. Pings all allowed users when urgent emails arrive.
   * Interval controlled by config.email.monitoring.intervalMinutes (default 15).
   */
  _startEmailMonitoring() {
    const intervalMs = (config.email?.monitoring?.intervalMinutes || 15) * 60 * 1000;
    logger.info(`[Bot] Email monitor started — checking every ${config.email?.monitoring?.intervalMinutes || 15} min`);

    setInterval(async () => {
      try {
        const { found, summary } = await this.email.scanUrgent();
        if (!found) return;
        const recipients = config.telegram.allowedUsers;
        for (const chatId of recipients) {
          await this._send(chatId, `🚨 *Urgent email alert!*\n\n${summary}`);
        }
      } catch (err) {
        logger.warn(`[Bot] Email monitor error: ${err.message}`);
      }
    }, intervalMs);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Weather
  // ─────────────────────────────────────────────────────────────────────────
  async _handleWeather(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const location = text || 'Mumbai';
    const stop = this._startTyping(chatId);
    try {
      const result = await this.weatherTool.getWeather({ location });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Weather error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pomodoro
  // ─────────────────────────────────────────────────────────────────────────
  async _handlePomodoro(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      const args = text.trim().split(/\s+/);
      const sub = args[0]?.toLowerCase() || 'status';
      let result;
      if (sub === 'start') {
        const task = args.slice(1).join(' ') || 'Focus session';
        result = await this.pomodoroTool.start({ task });
      } else if (sub === 'pause') {
        result = await this.pomodoroTool.pause();
      } else if (sub === 'resume') {
        result = await this.pomodoroTool.resume();
      } else if (sub === 'stop') {
        result = await this.pomodoroTool.stop();
      } else if (sub === 'stats') {
        result = await this.pomodoroTool.stats();
      } else {
        result = await this.pomodoroTool.status();
      }
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Pomodoro error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Habits
  // ─────────────────────────────────────────────────────────────────────────
  async _handleHabits(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      const args = text.trim().split(/\s+/);
      const sub = args[0]?.toLowerCase() || 'list';
      let result;
      if (sub === 'add') {
        const name = args.slice(1).join(' ');
        result = await this.habitsTool.add({ name });
      } else if (sub === 'done') {
        const name = args.slice(1).join(' ');
        result = await this.habitsTool.done({ name });
      } else if (sub === 'stats') {
        const name = args.slice(1).join(' ');
        result = await this.habitsTool.stats({ name });
      } else if (sub === 'remove' || sub === 'delete') {
        const name = args.slice(1).join(' ');
        result = await this.habitsTool.remove({ name });
      } else {
        result = await this.habitsTool.list();
      }
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Habits error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Crypto / Stock
  // ─────────────────────────────────────────────────────────────────────────
  async _handleCrypto(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!text) {
      await this._send(chatId, 'Usage: `/crypto <coin>` e.g. `/crypto BTC` or `/stock AAPL`');
      return;
    }
    const stop = this._startTyping(chatId);
    try {
      const result = await this.cryptoTool.price({ coin: text.toUpperCase() });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Price error: ${err.message}`);
    } finally {
      stop();
    }
  }

  async _handleCryptoTop(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      const n = parseInt(text, 10) || 10;
      const result = await this.cryptoTool.top({ n });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Top crypto error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // World Clock / Timezone
  // ─────────────────────────────────────────────────────────────────────────
  async _handleWorldClock(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      let result;
      if (!text) {
        result = await this.worldClock.now({ cities: ['Mumbai', 'London', 'New York', 'Tokyo', 'Sydney'] });
      } else if (text.toLowerCase().includes(' to ')) {
        // e.g. "9am IST to PST"
        const [timePart, toPart] = text.split(/ to /i);
        const fromTz = 'IST';
        result = await this.worldClock.convert({ time: timePart.trim(), from: fromTz, to: toPart.trim() });
      } else {
        const cities = text.split(',').map(c => c.trim());
        result = await this.worldClock.now({ cities });
      }
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Clock error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TTS / Speak
  // ─────────────────────────────────────────────────────────────────────────
  async _handleSpeak(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!text) {
      await this._send(chatId, 'Usage: `/speak <text to say>` — speaks the text via macOS TTS');
      return;
    }
    const stop = this._startTyping(chatId);
    try {
      const result = await this.voiceNote.speak({ text });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Speak error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QR Code
  // ─────────────────────────────────────────────────────────────────────────
  async _handleQRCode(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!text) {
      await this._send(chatId, 'Usage: `/qr <URL or text>` — generates a QR code');
      return;
    }
    const stop = this._startTyping(chatId);
    try {
      const result = await this.qrCode.generate({ text });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ QR error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dev Tools
  // ─────────────────────────────────────────────────────────────────────────
  async _handleDevTool(msg, op, input) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      let result;
      if (op === 'uuid') {
        result = await this.devTools.uuid();
      } else if (op === 'password') {
        const len = parseInt(input, 10) || 20;
        result = await this.devTools.generatePassword({ length: len });
      } else if (op === 'hash') {
        if (!input) { await this._send(chatId, 'Usage: `/hash <text>`'); stop(); return; }
        result = await this.devTools.hash({ text: input });
      } else if (op === 'base64') {
        if (!input) { await this._send(chatId, 'Usage: `/b64 encode:<text>` or `/b64 decode:<text>`'); stop(); return; }
        const isEncode = !input.startsWith('decode:');
        const raw = input.replace(/^(en|de)code:/i, '');
        result = await this.devTools.base64({ text: raw, mode: isEncode ? 'encode' : 'decode' });
      }
      if (result) await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ DevTool error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Disk / File Watcher
  // ─────────────────────────────────────────────────────────────────────────
  async _handleDisk(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      const path = text || '~';
      const result = await this.fileWatcher.overview({ path });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Disk error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Automation helpers
  // ─────────────────────────────────────────────────────────────────────────
  async _handleOpenApp(msg, appName) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      const result = await this.automation.openApp({ name: appName });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Could not open app: ${err.message}`);
    } finally {
      stop();
    }
  }

  async _handleVolume(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      const level = parseInt(text, 10);
      let result;
      if (isNaN(level)) {
        result = await this.automation.mute();
      } else {
        result = await this.automation.setVolume({ level });
      }
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Volume error: ${err.message}`);
    } finally {
      stop();
    }
  }

  async _handleDarkMode(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const stop = this._startTyping(chatId);
    try {
      const mode = text?.toLowerCase();
      const enable = mode === 'on' ? true : mode === 'off' ? false : undefined;
      const result = await this.automation.darkMode({ enable });
      await this._send(chatId, result);
    } catch (err) {
      await this._send(chatId, `❌ Dark mode error: ${err.message}`);
    } finally {
      stop();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Chess
  // ─────────────────────────────────────────────────────────────────────────

  async _handleChessCommand(msg, text) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;

    // If already in a game, treat argument as a move
    if (this.chessGame.hasGame(chatId)) {
      if (!text) {
        const r = this.chessGame.showBoard(chatId);
        await this._send(chatId, r.text);
        return;
      }
      await this._handleChessMove(msg, text);
      return;
    }

    // Start new game
    const colorMatch = text.match(/\b(black|white)\b/i);
    const color = colorMatch ? colorMatch[1][0].toLowerCase() : 'w';
    const res = this.chessGame.start(chatId, color);
    await this._send(chatId, res.text);
  }

  async _handleChessMove(msg, moveInput) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!this.chessGame.hasGame(chatId)) {
      await this._send(chatId, '♟️ No active chess game. Type `/chess` to start one!');
      return;
    }
    const res = this.chessGame.move(chatId, moveInput);
    if (!res) {
      // null means the input isn't a move — let it fall through to _handleTask
      this._handleTask(msg, msg.text.trim());
      return;
    }
    await this._send(chatId, res.text);
  }

  async _handleChessResign(msg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    if (!this.chessGame.hasGame(chatId)) {
      await this._send(chatId, 'No active game to resign from.');
      return;
    }
    const res = this.chessGame.resign(chatId);
    await this._send(chatId, res.text);
  }

  async _handleChessBoard(msg) {
    const chatId = this._chatId(msg);
    if (!this._isAuthorized(msg)) return;
    const r = this.chessGame.showBoard(chatId);
    if (!r) {
      await this._send(chatId, '♟️ No active game. Type `/chess` to start one!');
      return;
    }
    await this._send(chatId, r.text);
  }
}
