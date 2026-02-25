/**
 * tools/terminal.js
 * Safe shell command execution with output capture and dangerous command filtering.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export class Terminal {
  /**
   * Run a shell command inside `workDir`.
   * @param {string} command
   * @param {string} workDir
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   */
  async runCommand(command, workDir = '.') {
    if (!command || !command.trim()) {
      return { stdout: '', stderr: 'No command provided.', exitCode: 1 };
    }
    this._assertSafe(command);

    logger.info(`[Terminal] $ ${command}  (cwd: ${workDir})`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout: config.agent.stepTimeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      const out = stdout || '';
      const err = stderr || '';
      logger.debug(`[Terminal] STDOUT: ${out.slice(0, 500)}`);
      if (err) logger.debug(`[Terminal] STDERR: ${err.slice(0, 500)}`);

      return { stdout: out, stderr: err, exitCode: 0 };
    } catch (err) {
      const stdout = err.stdout || '';
      const stderr = err.stderr || err.message || '';
      const exitCode = err.code || 1;

      logger.warn(`[Terminal] Command failed (exit ${exitCode}): ${stderr.slice(0, 300)}`);
      return { stdout, stderr, exitCode };
    }
  }

  /**
   * Run a long-running background process and return the PID.
   */
  runBackground(command, workDir = '.') {
    this._assertSafe(command);
    const child = spawn(command, { shell: true, cwd: workDir, detached: true, stdio: 'ignore' });
    child.unref();
    logger.info(`[Terminal] Background process started (PID ${child.pid}): ${command}`);
    return child.pid;
  }

  // ── Safety guard ──────────────────────────────────

  _assertSafe(command) {
    for (const pattern of config.dangerousCommandPatterns) {
      if (pattern.test(command)) {
        const err = new Error(`BLOCKED: Dangerous command detected → ${command}`);
        logger.error(err.message);
        throw err;
      }
    }
  }
}
