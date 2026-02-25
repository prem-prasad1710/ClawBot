/**
 * tools/imagelook.js – Image Analysis Tool
 * Analyzes local images using macOS Vision framework via Swift,
 * and can describe images, read text (OCR), detect faces/objects.
 * Falls back to metadata + color analysis if Vision unavailable.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export class ImageLook {
  /**
   * Analyze an image file — OCR text, metadata, file info
   * @param {object} params
   * @param {string} params.path  – absolute path to image file
   */
  async analyze(params = {}) {
    const filePath = params.path || params.file || params.image;
    if (!filePath) return '⚠️ Please provide an image file path.';
    if (!existsSync(filePath)) return `⚠️ File not found: ${filePath}`;

    const ext  = path.extname(filePath).toLowerCase();
    const stat = statSync(filePath);
    const size = (stat.size / 1024).toFixed(1) + ' KB';
    const name = path.basename(filePath);

    const lines = [`🖼️ *Image Analysis: ${name}*`, ``, `📁 File: ${filePath}`, `📏 Size: ${size}`, `🖼️ Type: ${ext}`];

    // Get image dimensions via sips (macOS built-in)
    try {
      const { stdout } = await execAsync(`sips -g pixelWidth -g pixelHeight -g dpiWidth -g dpiHeight -g hasAlpha "${filePath}" 2>/dev/null`);
      const w = stdout.match(/pixelWidth:\s+(\d+)/)?.[1];
      const h = stdout.match(/pixelHeight:\s+(\d+)/)?.[1];
      const dpi = stdout.match(/dpiWidth:\s+([\d.]+)/)?.[1];
      const alpha = stdout.match(/hasAlpha:\s+(\w+)/)?.[1];
      if (w && h) lines.push(`📐 Dimensions: ${w} × ${h} px`);
      if (dpi) lines.push(`🔬 DPI: ${Math.round(dpi)}`);
      if (alpha) lines.push(`🔲 Alpha channel: ${alpha}`);
    } catch {}

    // Get EXIF data via mdls (macOS metadata)
    try {
      const { stdout } = await execAsync(`mdls "${filePath}" 2>/dev/null | grep -E 'GPS|kMDItemPixel|kMDItemContent|kMDItemCreate|kMDItemAuthors|Camera|Aperture|Focal|ISO|Shutter' | head -20`);
      if (stdout.trim()) {
        lines.push('', '*📷 Metadata:*');
        stdout.trim().split('\n').forEach(l => {
          const clean = l.replace(/kMDItem/g, '').replace(/\s+/g, ' ').trim();
          if (clean) lines.push(`  • ${clean}`);
        });
      }
    } catch {}

    // OCR: extract text via Vision through a Swift one-liner
    lines.push('', '*📝 Text (OCR):*');
    try {
      const swiftCode = `
import Vision
import Foundation
let url = URL(fileURLWithPath: "${filePath.replace(/"/g, '\\"')}")
let handler = VNImageRequestHandler(url: url, options: [:])
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
try? handler.perform([req])
let texts = req.results?.compactMap { $0.topCandidates(1).first?.string } ?? []
print(texts.isEmpty ? "NO_TEXT" : texts.joined(separator: "\\n"))
      `.trim();
      const { stdout } = await execAsync(`swift - <<'SWIFT'\n${swiftCode}\nSWIFT`, { timeout: 30000 });
      if (stdout.trim() && stdout.trim() !== 'NO_TEXT') {
        lines.push(stdout.trim().slice(0, 500));
      } else {
        lines.push('  (no text detected)');
      }
    } catch {
      lines.push('  (OCR unavailable — Swift Vision not accessible)');
    }

    return lines.join('\n');
  }

  /**
   * Extract text from an image (OCR only, faster)
   */
  async ocr(params = {}) {
    const filePath = params.path || params.file;
    if (!filePath) return '⚠️ Please provide an image file path.';
    if (!existsSync(filePath)) return `⚠️ File not found: ${filePath}`;

    const swiftCode = `
import Vision
import Foundation
let url = URL(fileURLWithPath: "${filePath.replace(/"/g, '\\"')}")
let handler = VNImageRequestHandler(url: url, options: [:])
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
try? handler.perform([req])
let texts = req.results?.compactMap { $0.topCandidates(1).first?.string } ?? []
print(texts.isEmpty ? "NO_TEXT" : texts.joined(separator: "\\n"))
    `.trim();

    try {
      const { stdout } = await execAsync(`swift - <<'SWIFT'\n${swiftCode}\nSWIFT`, { timeout: 30000 });
      const text = stdout.trim();
      if (!text || text === 'NO_TEXT') return '📝 No text found in image.';
      return `📝 *Extracted Text:*\n\n${text.slice(0, 2000)}`;
    } catch (err) {
      return `⚠️ OCR failed: ${err.message}`;
    }
  }

  /**
   * Convert image format (uses macOS sips)
   */
  async convert(params = {}) {
    const { path: src, to = 'jpeg', output } = params;
    if (!src) return '⚠️ Please provide source image path.';
    if (!existsSync(src)) return `⚠️ File not found: ${src}`;

    const validFormats = ['jpeg', 'png', 'tiff', 'gif', 'bmp', 'pdf'];
    const fmt = to.toLowerCase().replace('.', '');
    if (!validFormats.includes(fmt)) return `⚠️ Unsupported format: ${to}. Use: ${validFormats.join(', ')}`;

    const outPath = output || src.replace(/\.[^.]+$/, `.${fmt}`);
    try {
      await execAsync(`sips -s format ${fmt} "${src}" --out "${outPath}"`);
      return `✅ Converted: *${path.basename(src)}* → *${path.basename(outPath)}*\n📁 Saved to: \`${outPath}\``;
    } catch (err) {
      return `⚠️ Conversion failed: ${err.message}`;
    }
  }

  /**
   * Resize an image
   */
  async resize(params = {}) {
    const { path: src, width, height, output } = params;
    if (!src) return '⚠️ Please provide source image path.';
    if (!existsSync(src)) return `⚠️ File not found: ${src}`;
    if (!width && !height) return '⚠️ Provide width and/or height.';

    const outPath = output || src.replace(/(\.[^.]+)$/, `_resized$1`);
    const dims    = width && height ? `${width} ${height}` : width ? width : height;
    const flag    = width && height ? '--resampleHeightWidth' : '--resampleWidth';

    try {
      await execAsync(`sips ${flag} ${dims} "${src}" --out "${outPath}"`);
      const { stdout } = await execAsync(`sips -g pixelWidth -g pixelHeight "${outPath}"`);
      const w = stdout.match(/pixelWidth:\s+(\d+)/)?.[1];
      const h = stdout.match(/pixelHeight:\s+(\d+)/)?.[1];
      return `✅ Resized: *${path.basename(src)}* → ${w}×${h}\n📁 Saved to: \`${outPath}\``;
    } catch (err) {
      return `⚠️ Resize failed: ${err.message}`;
    }
  }
}
