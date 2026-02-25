/**
 * tools/screenshot.js
 * Take screenshots on macOS using the built-in screencapture command.
 * Saves to ~/Desktop/ClawBot-Screenshots/ by default.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export class Screenshot {
  constructor() {
    this.defaultDir = join(homedir(), 'Desktop', 'ClawBot-Screenshots');
  }

  _ensureDir() {
    if (!existsSync(this.defaultDir)) {
      mkdirSync(this.defaultDir, { recursive: true });
    }
  }

  /**
   * Take a screenshot of the full screen.
   * @param {object} opts
   * @param {string}  [opts.filename]   - Absolute path. Defaults to timestamped file.
   * @param {boolean} [opts.open=false] - Open in Preview after capture.
   * @param {string}  [opts.window]     - Capture a specific window by app name.
   */
  capture({ filename, open = false, window: appWindow } = {}) {
    this._ensureDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const outFile = filename || join(this.defaultDir, `screenshot_${ts}.png`);

    let cmd;
    if (appWindow) {
      // Capture a specific app window
      cmd = `screencapture -x -o -l $(osascript -e 'tell application "${appWindow}" to id of window 1') "${outFile}"`;
    } else {
      cmd = `screencapture -x "${outFile}"`;
    }

    try {
      execSync(cmd, { timeout: 15000 });
      if (open) execSync(`open "${outFile}"`, { timeout: 5000 });
      return `📸 Screenshot saved: ${outFile}`;
    } catch (e) {
      return `Screenshot failed: ${e.message}`;
    }
  }

  /**
   * Open the screenshot folder in Finder.
   */
  openFolder() {
    this._ensureDir();
    execSync(`open "${this.defaultDir}"`);
    return `📁 Opened: ${this.defaultDir}`;
  }
}
