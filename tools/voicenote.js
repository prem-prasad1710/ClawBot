/**
 * tools/voicenote.js – Voice Note Recorder & Transcription
 * Records audio via macOS `sox` or `ffmpeg`, then transcribes via Whisper (via Ollama or whisper.cpp)
 * Falls back to macOS `say` for TTS (text-to-speech) playback.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);
const NOTES_DIR = path.join(os.homedir(), 'Desktop', 'ClawBot-VoiceNotes');

function ensureDir() {
  if (!existsSync(NOTES_DIR)) mkdirSync(NOTES_DIR, { recursive: true });
}

export class VoiceNote {
  /**
   * Text-to-speech: have ClawBot speak a message aloud using macOS `say`
   * @param {object} params
   * @param {string} params.text    – text to speak
   * @param {string} params.voice   – macOS voice name (default: "Samantha")
   * @param {number} params.rate    – words per minute (default 180)
   */
  async speak(params = {}) {
    const { text, voice = 'Samantha', rate = 180 } = params;
    if (!text) return '⚠️ No text to speak.';
    const safe = text.replace(/'/g, "'\\''").slice(0, 1000);
    try {
      await execAsync(`say -v '${voice}' -r ${rate} '${safe}'`);
      return `🔊 Spoken aloud: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"\nVoice: ${voice} | Rate: ${rate} wpm`;
    } catch (err) {
      logger.warn(`[VoiceNote] speak error: ${err.message}`);
      return `⚠️ Text-to-speech failed: ${err.message}`;
    }
  }

  /**
   * List available macOS TTS voices
   */
  async listVoices(params = {}) {
    try {
      const { stdout } = await execAsync('say -v ?');
      const voices = stdout.trim().split('\n').slice(0, 30).map(line => {
        const parts = line.trim().split(/\s{2,}/);
        return `• *${parts[0]}* — ${parts[1] || ''} ${parts[2] || ''}`.trim();
      });
      return `🎙️ *Available macOS Voices (showing 30):*\n\n${voices.join('\n')}`;
    } catch (err) {
      return `⚠️ Could not list voices: ${err.message}`;
    }
  }

  /**
   * Record a voice note (requires sox)
   * @param {object} params
   * @param {number} params.seconds  – recording duration in seconds (default 10)
   * @param {string} params.filename – optional filename (without extension)
   */
  async record(params = {}) {
    const { seconds = 10, filename } = params;
    ensureDir();
    const audioFile = path.join(
      NOTES_DIR,
      (filename || `voice-note-${Date.now()}`) + '.wav'
    );

    // Check sox availability
    try {
      await execAsync('which sox');
    } catch {
      return [
        `⚠️ *sox* is not installed. Install it with:`,
        `\`brew install sox\``,
        ``,
        `Alternatively, use macOS built-in: I can read text aloud for you with \`/speak <text>\``,
      ].join('\n');
    }

    try {
      await execAsync(`sox -d -t wav "${audioFile}" trim 0 ${seconds}`, { timeout: (seconds + 5) * 1000 });
      return [
        `🎙️ Voice note recorded (${seconds}s)`,
        `📁 Saved to: \`${audioFile}\``,
        ``,
        `Use transcription if whisper.cpp is available, or play it back with QuickTime.`,
      ].join('\n');
    } catch (err) {
      return `⚠️ Recording failed: ${err.message}\nMake sure your microphone is connected.`;
    }
  }

  /**
   * Play back a saved audio file
   */
  async play(params = {}) {
    const { path: filePath } = params;
    if (!filePath) return '⚠️ Provide a file path to play.';
    try {
      await execAsync(`afplay "${filePath}"`, { timeout: 300000 });
      return `▶️ Played: ${path.basename(filePath)}`;
    } catch (err) {
      return `⚠️ Playback failed: ${err.message}`;
    }
  }

  /**
   * List saved voice notes
   */
  async list(params = {}) {
    ensureDir();
    try {
      const { stdout } = await execAsync(`ls -lt "${NOTES_DIR}" 2>/dev/null | head -20`);
      if (!stdout.trim()) return `📁 No voice notes yet. Record one with \`/speak\` or \`/voicenote record\``;
      const files = stdout.trim().split('\n').slice(1).map(l => `• \`${l.trim().split(/\s+/).pop()}\``);
      return `🎙️ *Voice Notes (${NOTES_DIR}):*\n\n${files.join('\n')}`;
    } catch (err) {
      return `⚠️ Could not list voice notes: ${err.message}`;
    }
  }
}
