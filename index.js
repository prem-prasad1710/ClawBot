/**
 * index.js – ClawBot entry point
 * Starts the Telegram bot and the Ollama health check.
 */

// Must be set before any network calls – fixes macOS TLS certificate issues with Node.js
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import 'dotenv/config';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { ClawBotTelegram } from './telegram/bot.js';
import { config } from './config/config.js';
import { logger } from './utils/logger.js';
import fs from 'fs';
import path from 'path';

const BANNER = `
  ██████╗██╗      █████╗ ██╗    ██╗██████╗  ██████╗ ████████╗
 ██╔════╝██║     ██╔══██╗██║    ██║██╔══██╗██╔═══██╗╚══██╔══╝
 ██║     ██║     ███████║██║ █╗ ██║██████╔╝██║   ██║   ██║   
 ██║     ██║     ██╔══██║██║███╗██║██╔══██╗██║   ██║   ██║   
 ╚██████╗███████╗██║  ██║╚███╔███╔╝██████╔╝╚██████╔╝   ██║   
  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═════╝  ╚═════╝   ╚═╝   
     Autonomous AI Developer Agent  •  v2.0.0
`;

async function checkOllama() {
  try {
    const resp = await fetch(`${config.ollama.baseUrl}/api/tags`, { timeout: 5000 });
    const data = await resp.json();
    const models = (data.models || []).map((m) => m.name);
    const modelAvailable = models.includes(config.ollama.model) ||
      models.some((m) => m.startsWith(config.ollama.model.split(':')[0]));

    if (!modelAvailable) {
      logger.warn(`Model "${config.ollama.model}" not found locally. Available: ${models.join(', ')}`);
      logger.warn(`Run: ollama pull ${config.ollama.model}`);
    } else {
      logger.info(`Ollama OK – model "${config.ollama.model}" ready.`);
    }
    return true;
  } catch {
    logger.error('Cannot connect to Ollama. Make sure `ollama serve` is running.');
    logger.error(`Expected at: ${config.ollama.baseUrl}`);
    return false;
  }
}

function ensureWorkspace() {
  const dir = config.agent.workspaceDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created workspace: ${dir}`);
  }
}

async function main() {
  console.log(chalk.cyan(BANNER));

  if (!config.telegram.token) {
    logger.error('TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  ensureWorkspace();

  logger.info('Checking Ollama connection…');
  await checkOllama();

  logger.info(`Starting ClawBot Telegram bot…`);
  logger.info(`Model: ${config.ollama.model}`);
  logger.info(`Workspace: ${config.agent.workspaceDir}`);
  if (config.telegram.allowedUsers.length) {
    logger.info(`Allowed users: ${config.telegram.allowedUsers.join(', ')}`);
  } else {
    logger.warn('No ALLOWED_USER_IDS set – any Telegram user can control this bot!');
  }

  new ClawBotTelegram();
  logger.info('ClawBot is live. Send a message on Telegram to begin.');
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
