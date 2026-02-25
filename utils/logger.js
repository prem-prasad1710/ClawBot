/**
 * utils/logger.js
 * Lightweight structured logger with file + console output.
 */

import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Foreground colors
const C = {
  debug:  '\x1b[36m',   // cyan
  info:   '\x1b[32m',   // green
  warn:   '\x1b[33m',   // yellow
  error:  '\x1b[31m',   // red
  time:   '\x1b[90m',   // grey
  bold:   '\x1b[1m',
  reset:  '\x1b[0m',
};

// Visual badges per level
const BADGE = {
  debug: `${C.debug}◆ DEBUG${C.reset}`,
  info:  `${C.info}${C.bold}● INFO ${C.reset}`,
  warn:  `${C.warn}${C.bold}▲ WARN ${C.reset}`,
  error: `${C.error}${C.bold}✖ ERROR${C.reset}`,
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

  // Visually prominent separator for major lifecycle events
  section(title) {
    const line = '─'.repeat(60);
    console.log(`\n${C.bold}${line}${C.reset}`);
    console.log(`${C.bold}  ${title}${C.reset}`);
    console.log(`${C.bold}${line}${C.reset}\n`);
  }

  _log(level, msg) {
    if (LEVELS[level] < this._level) return;

    const ts   = new Date().toTimeString().slice(0, 8); // HH:MM:SS only – less noise
    const plain = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
    const colored = `${C.time}${ts}${C.reset}  ${BADGE[level]}  ${msg}`;

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
