/**
 * tools/automation.js – macOS Automation Shortcuts
 * Control System Preferences, launch apps, manage windows, power.
 * Uses AppleScript + shell commands.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export class Automation {
  /** Open any application */
  async openApp(params = {}) {
    const app = params.app || params.name || '';
    if (!app) return '⚠️ Specify an app to open.';
    try {
      await execAsync(`open -a "${app}"`);
      return `✅ Opened *${app}*`;
    } catch (err) {
      return `⚠️ Could not open ${app}: ${err.message}`;
    }
  }

  /** Open a URL in the default browser */
  async openUrl(params = {}) {
    const url = params.url || params.link || '';
    if (!url) return '⚠️ Specify a URL to open.';
    try {
      await execAsync(`open "${url}"`);
      return `✅ Opened: ${url}`;
    } catch (err) {
      return `⚠️ Could not open URL: ${err.message}`;
    }
  }

  /** Set system volume */
  async setVolume(params = {}) {
    const level = parseInt(params.level ?? params.volume ?? 50);
    if (isNaN(level) || level < 0 || level > 100) return '⚠️ Volume must be 0–100.';
    try {
      await execAsync(`osascript -e 'set volume output volume ${level}'`);
      return `🔊 Volume set to *${level}%*`;
    } catch (err) {
      return `⚠️ Could not set volume: ${err.message}`;
    }
  }

  /** Mute/unmute system audio */
  async mute(params = {}) {
    const muted = params.muted !== false;
    try {
      await execAsync(`osascript -e 'set volume ${muted ? 'output muted true' : 'output muted false'}'`);
      return muted ? '🔇 System audio muted.' : '🔊 System audio unmuted.';
    } catch (err) {
      return `⚠️ ${err.message}`;
    }
  }

  /** Set screen brightness */
  async setBrightness(params = {}) {
    const level = parseFloat(params.level ?? params.brightness ?? 0.8);
    if (isNaN(level) || level < 0 || level > 1) return '⚠️ Brightness must be 0.0–1.0';
    try {
      // Uses macOS brightness CLI (requires brightness tool or AppleScript workaround)
      await execAsync(`osascript -e 'tell application "System Events" to set the brightness of every display to ${level}'`).catch(async () => {
        // Fallback: use Keyboard brightness script
        await execAsync(`brightness ${level}`);
      });
      return `☀️ Brightness set to *${Math.round(level * 100)}%*`;
    } catch (err) {
      return `⚠️ Brightness control needs \`brew install brightness\`: ${err.message}`;
    }
  }

  /** Toggle Dark Mode */
  async darkMode(params = {}) {
    const enable = params.enable !== false && params.off !== true;
    const mode   = enable ? 'true' : 'false';
    try {
      await execAsync(`osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to ${mode}'`);
      return enable ? '🌙 Dark Mode *enabled*.' : '☀️ Dark Mode *disabled* (Light Mode on).';
    } catch (err) {
      return `⚠️ Could not toggle Dark Mode: ${err.message}`;
    }
  }

  /** Lock screen */
  async lockScreen(params = {}) {
    try {
      await execAsync(`osascript -e 'tell application "System Events" to keystroke "q" using {command down, control down}'`);
      return '🔒 Screen locked.';
    } catch {
      try {
        await execAsync(`/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend`);
        return '🔒 Screen locked.';
      } catch (err) {
        return `⚠️ ${err.message}`;
      }
    }
  }

  /** Empty trash */
  async emptyTrash(params = {}) {
    try {
      await execAsync(`osascript -e 'tell application "Finder" to empty trash'`);
      return '🗑️ Trash emptied.';
    } catch (err) {
      return `⚠️ ${err.message}`;
    }
  }

  /** List running applications */
  async listApps(params = {}) {
    try {
      const { stdout } = await execAsync(`osascript -e 'tell application "System Events" to get name of every application process whose background only is false'`);
      const apps = stdout.trim().split(', ').map(a => `• ${a}`);
      return [`🖥️ *Running Applications (${apps.length}):*`, ``, ...apps].join('\n');
    } catch (err) {
      try {
        const { stdout } = await execAsync(`ps aux | grep -E '\\.(app)' | grep -v grep | awk '{print $11}' | sort -u | head -20`);
        return `🖥️ *Running Apps:*\n\n${stdout}`;
      } catch (e2) {
        return `⚠️ ${e2.message}`;
      }
    }
  }

  /** Quit an application */
  async quitApp(params = {}) {
    const app = params.app || params.name || '';
    if (!app) return '⚠️ Specify an app to quit.';
    try {
      await execAsync(`osascript -e 'tell application "${app}" to quit'`);
      return `✅ Quit *${app}*`;
    } catch (err) {
      return `⚠️ Could not quit ${app}: ${err.message}`;
    }
  }

  /** Do Not Disturb mode toggle */
  async doNotDisturb(params = {}) {
    const enable = params.enable !== false;
    try {
      // macOS 13+ Focus mode toggle via shortcuts
      const action = enable ? 'on' : 'off';
      await execAsync(`shortcuts run "${enable ? 'Enable' : 'Disable'} Do Not Disturb"`).catch(async () => {
        // Fallback via osascript
        await execAsync(`osascript -e 'tell application "System Events" to tell do not disturb to set enabled to ${enable}'`);
      });
      return enable ? '🔕 *Do Not Disturb* enabled.' : '🔔 *Do Not Disturb* disabled.';
    } catch (err) {
      return `⚠️ DND toggle may require macOS Focus shortcuts: ${err.message}`;
    }
  }

  /** Get clipboard history idea — show what's currently on clipboard */
  async showClipboard(params = {}) {
    try {
      const { stdout } = await execAsync(`pbpaste`);
      const content = stdout.trim();
      if (!content) return '📋 Clipboard is empty.';
      return `📋 *Clipboard contents:*\n\n${content.slice(0, 1000)}${content.length > 1000 ? '…' : ''}`;
    } catch (err) {
      return `⚠️ ${err.message}`;
    }
  }

  /** Type text (simulate keyboard) - useful for automation */
  async typeText(params = {}) {
    const text = params.text || '';
    if (!text) return '⚠️ No text to type.';
    const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    try {
      await execAsync(`osascript -e 'tell application "System Events" to keystroke "${safe}"'`);
      return `⌨️ Typed: "${text.slice(0, 50)}"`;;
    } catch (err) {
      return `⚠️ ${err.message}`;
    }
  }
}
