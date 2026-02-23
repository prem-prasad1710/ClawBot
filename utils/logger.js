/**
 * utils/logger.js
 * Lightweight structured logger with file + console output.
 */

import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[36m',
  info:  '\x1b[32m',
  warn:  '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};

class Logger {
  constructor() {
    this._level = LEVELS[config.logging.level] ?? LEVELS.info;
    this._logDir = config.logging.dir;
    this._ensureLogDir();
  }

  debug(msg) { this._log('debug', msg); }
  info(msg)  { this._log('info',  msg); }
  warn(msg)  { this._log('warn',  msg); }
  error(msg) { this._log('error', msg); }

  _log(level, msg) {
    if (LEVELS[level] < this._level) return;

    const ts = new Date().toISOString();
    const coloredLevel = `${COLORS[level]}[${level.toUpperCase()}]${COLORS.reset}`;
    const plain = `[${ts}] [${level.toUpperCase()}] ${msg}`;
    const colored = `${COLORS[level]}[${ts}]${COLORS.reset} ${coloredLevel} ${msg}`;

    console.log(colored);
    this._appendToFile(plain);
  }

  _appendToFile(line) {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const file = path.join(this._logDir, `clawbot-${date}.log`);
      fs.appendFileSync(file, line + '\n');
    } catch { /* non-fatal */ }
  }

  _ensureLogDir() {
    try {
      if (!fs.existsSync(this._logDir)) {
        fs.mkdirSync(this._logDir, { recursive: true });
      }
    } catch { /* non-fatal */ }
  }
}

export const logger = new Logger();
