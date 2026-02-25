/**
 * tools/clipboard.js
 * Read and write the macOS clipboard via pbpaste / pbcopy.
 */

import { execSync, execFileSync } from 'child_process';

export class Clipboard {
  /**
   * Read the current clipboard contents.
   */
  read() {
    try {
      const text = execSync('pbpaste', { timeout: 5000 }).toString();
      if (!text.trim()) return '(Clipboard is empty)';
      return `📋 Clipboard contents:\n\n${text}`;
    } catch (e) {
      return `Error reading clipboard: ${e.message}`;
    }
  }

  /**
   * Write text to the clipboard.
   * @param {string} text
   */
  write(text) {
    try {
      // Use echo + pipe so no shell escaping issues
      execFileSync('bash', ['-c', `printf '%s' ${JSON.stringify(text)} | pbcopy`], { timeout: 5000 });
      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
      return `✅ Copied to clipboard: "${preview}"`;
    } catch (e) {
      return `Error writing clipboard: ${e.message}`;
    }
  }
}
