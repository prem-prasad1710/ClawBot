/**
 * tools/qrcode.js – QR Code Generator
 * Generates QR codes as PNG images on disk + ASCII preview in terminal.
 * Uses the `qrcode` npm package.
 */
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);
const QR_DIR = path.join(os.homedir(), 'Desktop', 'ClawBot-QRCodes');

function ensureDir() {
  if (!existsSync(QR_DIR)) mkdirSync(QR_DIR, { recursive: true });
}

export class QRCodeTool {
  /**
   * Generate a QR code for any text/URL
   * @param {object} params
   * @param {string} params.text       – content to encode
   * @param {string} params.filename   – optional output filename (without .png)
   * @param {boolean} params.open      – open image after creation (default true)
   * @param {number} params.size       – size multiplier 1-10 (default 4)
   */
  async generate(params = {}) {
    const { text, filename, open: openAfter = true, size = 4 } = params;
    if (!text) return '⚠️ Please provide text or a URL to encode.';
    ensureDir();

    let QRCode;
    try {
      const mod = await import('qrcode');
      QRCode = mod.default || mod;
    } catch {
      return [
        `⚠️ \`qrcode\` package not installed.`,
        `Run: \`npm install qrcode\` then try again.`,
      ].join('\n');
    }

    const safeName = (filename || `qr-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath  = path.join(QR_DIR, `${safeName}.png`);

    try {
      await QRCode.toFile(filePath, text, {
        type: 'png',
        scale: size,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' },
      });

      // Also generate ASCII version for Telegram text display
      const ascii = await QRCode.toString(text, { type: 'terminal', small: true });
      const asciiDisplay = ascii.slice(0, 800); // trim for Telegram

      if (openAfter) {
        execAsync(`open "${filePath}"`).catch(() => {});
      }

      return [
        `✅ *QR Code generated!*`,
        ``,
        `📝 Content: \`${text.slice(0, 80)}${text.length > 80 ? '…' : ''}\``,
        `📁 Saved to: \`${filePath}\``,
        ``,
        `*Preview:*`,
        `\`\`\``,
        asciiDisplay,
        `\`\`\``,
      ].join('\n');
    } catch (err) {
      logger.warn(`[QRCode] Error: ${err.message}`);
      return `⚠️ QR code generation failed: ${err.message}`;
    }
  }

  /**
   * Generate a vCard QR code for a contact
   */
  async contact(params = {}) {
    const { name, phone, email, org, url } = params;
    if (!name) return '⚠️ Please provide at least a name.';
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${name}`,
      phone ? `TEL:${phone}` : '',
      email ? `EMAIL:${email}` : '',
      org ? `ORG:${org}` : '',
      url ? `URL:${url}` : '',
      'END:VCARD',
    ].filter(Boolean).join('\n');

    return this.generate({ text: vcard, filename: `contact-${name.replace(/\s/g, '_')}` });
  }

  /**
   * Generate a WiFi QR code (scan to connect)
   */
  async wifi(params = {}) {
    const { ssid, password, security = 'WPA' } = params;
    if (!ssid) return '⚠️ Please provide the WiFi network name (SSID).';
    const wifiStr = `WIFI:T:${security};S:${ssid};P:${password || ''};H:false;;`;
    return this.generate({ text: wifiStr, filename: `wifi-${ssid.replace(/\s/g, '_')}` });
  }
}
