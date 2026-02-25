/**
 * tools/pdf.js
 * Extract text from PDF files.
 * Uses pdftotext (poppler) if installed, falls back to mdls/strings.
 * Install poppler for best results: brew install poppler
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

export class PDFReader {
  /**
   * Extract text from a PDF file.
   * @param {string} filePath  Absolute path to the PDF.
   * @param {number} maxChars  Max characters to return (default 8000).
   * @returns {string}
   */
  read(filePath, maxChars = 8000) {
    if (!filePath) return 'ERROR: No file path provided.';
    if (!existsSync(filePath)) return `File not found: ${filePath}`;

    // Method 1: pdftotext (best quality, needs poppler)
    try {
      execSync('which pdftotext', { timeout: 2000 });
      const text = execSync(`pdftotext "${filePath}" -`, { timeout: 30000 }).toString();
      const result = text.trim();
      if (result) {
        const truncated = result.length > maxChars;
        return (
          `📄 PDF: ${filePath}\n` +
          `────────────────────────────────\n` +
          result.slice(0, maxChars) +
          (truncated ? `\n…(truncated — ${result.length} chars total)` : '')
        );
      }
    } catch { /* fall through */ }

    // Method 2: mdls (macOS Spotlight metadata — gets some text)
    try {
      const meta = execSync(`mdls "${filePath}" 2>/dev/null | grep -v '(null)'`, { timeout: 5000 }).toString();
      if (meta.trim()) {
        return `📄 PDF metadata (install poppler for full text):\n${meta.slice(0, maxChars)}`;
      }
    } catch { /* fall through */ }

    // Method 3: strings extraction (unreliable but works without extra tools)
    try {
      const text = execSync(`strings "${filePath}"`, { timeout: 10000 }).toString();
      const clean = text
        .split('\n')
        .filter(l => l.trim().length > 4 && /[a-zA-Z]/.test(l))
        .join('\n');
      const truncated = clean.length > maxChars;
      return (
        `📄 PDF (raw text extraction — install poppler for better results: brew install poppler)\n` +
        `────────────────────────────────\n` +
        clean.slice(0, maxChars) +
        (truncated ? '\n…(truncated)' : '')
      );
    } catch (e) {
      return `Cannot read PDF: ${e.message}\nTip: install poppler → brew install poppler`;
    }
  }

  /**
   * Get page count and metadata.
   */
  info(filePath) {
    if (!existsSync(filePath)) return `File not found: ${filePath}`;
    try {
      execSync('which pdfinfo', { timeout: 2000 });
      return execSync(`pdfinfo "${filePath}"`, { timeout: 10000 }).toString().trim();
    } catch {
      return `pdfinfo not available. Install poppler: brew install poppler\nFile: ${filePath}`;
    }
  }
}
