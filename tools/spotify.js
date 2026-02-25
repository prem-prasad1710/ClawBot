/**
 * tools/spotify.js
 * Control Spotify on macOS via AppleScript.
 * Supports: now playing, play, pause, next, previous, volume.
 */

import { execSync } from 'child_process';

function spotify(cmd, timeout = 5000) {
  try {
    const result = execSync(`osascript -e 'tell application "Spotify" to ${cmd}'`, { timeout });
    return result.toString().trim();
  } catch (e) {
    // If Spotify is not running, give a helpful error
    if (e.message.includes('not running') || e.message.includes("can't be opened")) {
      return 'Spotify is not running. Launch it first.';
    }
    throw e;
  }
}

function isRunning() {
  try {
    const out = execSync(`osascript -e 'application "Spotify" is running'`, { timeout: 3000 });
    return out.toString().trim() === 'true';
  } catch {
    return false;
  }
}

export class Spotify {
  now() {
    if (!isRunning()) return '🎵 Spotify is not running.';
    try {
      const track  = spotify('name of current track as text');
      const artist = spotify('artist of current track as text');
      const album  = spotify('album of current track as text');
      const state  = spotify('player state as text');
      const pos    = spotify('player position as integer');
      const dur    = spotify('duration of current track as integer');
      const posStr = this._formatTime(pos);
      const durStr = this._formatTime(Math.round(dur / 1000));
      const icon   = state === 'playing' ? '▶️' : '⏸️';
      return `${icon} *${track}*\n👤 ${artist}\n💿 ${album}\n⏱️ ${posStr} / ${durStr}`;
    } catch (e) {
      return `Spotify error: ${e.message}`;
    }
  }

  play(query = '') {
    if (!isRunning()) {
      execSync(`open -a Spotify`, { timeout: 5000 });
      execSync(`sleep 2`);
    }
    if (query) {
      // Search and play via Spotify URI
      try {
        spotify(`play track "spotify:search:${encodeURIComponent(query)}"`);
        return `▶️ Playing: ${query}`;
      } catch {
        spotify('play');
        return `▶️ Resumed (search not available via AppleScript).`;
      }
    }
    spotify('play');
    return '▶️ Spotify playing.';
  }

  pause() {
    if (!isRunning()) return 'Spotify is not running.';
    spotify('pause');
    return '⏸️ Spotify paused.';
  }

  next() {
    if (!isRunning()) return 'Spotify is not running.';
    spotify('next track');
    const track = spotify('name of current track as text');
    const artist = spotify('artist of current track as text');
    return `⏭️ Next: *${track}* — ${artist}`;
  }

  previous() {
    if (!isRunning()) return 'Spotify is not running.';
    spotify('previous track');
    const track = spotify('name of current track as text');
    const artist = spotify('artist of current track as text');
    return `⏮️ Previous: *${track}* — ${artist}`;
  }

  volume(level) {
    if (!isRunning()) return 'Spotify is not running.';
    const vol = Math.max(0, Math.min(100, parseInt(level) || 50));
    spotify(`set sound volume to ${vol}`);
    return `🔊 Volume set to ${vol}%.`;
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
