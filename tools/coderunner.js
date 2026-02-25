/**
 * tools/coderunner.js
 * Execute code snippets safely in a subprocess.
 * Supports: Python, Node.js / JavaScript, Bash.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 15000; // 15 second hard limit per snippet

const LANG_CONFIG = {
  python:     { ext: '.py',  cmd: 'python3',  args: (f) => [f] },
  javascript: { ext: '.mjs', cmd: 'node',     args: (f) => [f] },
  js:         { ext: '.mjs', cmd: 'node',     args: (f) => [f] },
  bash:       { ext: '.sh',  cmd: 'bash',     args: (f) => [f] },
  sh:         { ext: '.sh',  cmd: 'bash',     args: (f) => [f] },
};

export class CodeRunner {
  /**
   * Run a code snippet.
   * @param {object} params - { language, code }
   * @returns {Promise<string>}
   */
  async run({ language = 'python', code = '' }) {
    const lang = language.toLowerCase().trim();
    const cfg = LANG_CONFIG[lang];
    if (!cfg) {
      return `Unsupported language: ${language}. Supported: python, javascript, bash`;
    }

    if (!code.trim()) {
      return 'No code provided.';
    }

    // Write to a temp file
    const tmpFile = path.join(tmpdir(), `clawbot_snippet_${Date.now()}${cfg.ext}`);
    try {
      writeFileSync(tmpFile, code, 'utf8');
      logger.info(`[CodeRunner] Running ${lang} snippet (${code.length} chars)`);

      const { stdout, stderr } = await execFileAsync(
        cfg.cmd,
        cfg.args(tmpFile),
        { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }
      );

      const output = [];
      if (stdout) output.push(`STDOUT:\n${stdout.trim()}`);
      if (stderr)  output.push(`STDERR:\n${stderr.trim()}`);
      return output.join('\n') || '(no output)';

    } catch (err) {
      if (err.killed) return `Execution timed out after ${TIMEOUT_MS / 1000}s`;
      const out = [];
      if (err.stdout) out.push(`STDOUT:\n${err.stdout.trim()}`);
      if (err.stderr) out.push(`STDERR:\n${err.stderr.trim()}`);
      return out.join('\n') || `Error: ${err.message}`;
    } finally {
      try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch (_) {}
    }
  }
}
