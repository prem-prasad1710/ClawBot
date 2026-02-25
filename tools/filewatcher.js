/**
 * tools/filewatcher.js – File Watcher & Directory Monitor
 * Watch files/directories for changes and report in real-time.
 * Also provides: disk usage analysis, duplicate file finder, large file finder.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export class FileWatcher {
  constructor() {
    this._watchers = new Map(); // id → { proc, path, startedAt }
  }

  /**
   * Analyze disk usage of a directory (top 20 items by size)
   * @param {object} params
   * @param {string} params.path  – directory to analyze (default: home dir)
   * @param {number} params.depth – folder depth (default 1)
   */
  async diskUsage(params = {}) {
    const dir   = params.path || params.dir || os.homedir();
    const depth = parseInt(params.depth || 1);
    if (!existsSync(dir)) return `⚠️ Directory not found: ${dir}`;

    try {
      const { stdout } = await execAsync(
        `du -sh "${dir}"/* 2>/dev/null | sort -rh | head -20`,
        { timeout: 30000 }
      );
      if (!stdout.trim()) return '📁 Directory is empty.';

      const lines = stdout.trim().split('\n').map((l, i) => {
        const parts = l.split('\t');
        const size  = parts[0] || '';
        const name  = path.basename(parts[1] || '');
        return `${i + 1}. \`${size.padEnd(8)}\` ${name}`;
      });

      const { stdout: total } = await execAsync(`du -sh "${dir}" 2>/dev/null`).catch(() => ({ stdout: '?' }));
      const totalSize = total.split('\t')[0];

      return [
        `💾 *Disk Usage: ${dir}*`,
        `Total: *${totalSize}*`,
        ``,
        ...lines,
      ].join('\n');
    } catch (err) {
      return `⚠️ Disk usage analysis failed: ${err.message}`;
    }
  }

  /**
   * Find large files in a directory
   * @param {object} params
   * @param {string} params.path  – directory to search
   * @param {string} params.size  – minimum size like "100M", "1G" (default "50M")
   * @param {number} params.limit – max results (default 10)
   */
  async findLarge(params = {}) {
    const dir   = params.path || params.dir || os.homedir();
    const size  = params.size || '50M';
    const limit = parseInt(params.limit || 10);
    if (!existsSync(dir)) return `⚠️ Directory not found: ${dir}`;

    try {
      const { stdout } = await execAsync(
        `find "${dir}" -type f -size +${size} 2>/dev/null | head -${limit} | xargs -I{} du -sh "{}" 2>/dev/null | sort -rh`,
        { timeout: 30000 }
      );
      if (!stdout.trim()) return `📁 No files larger than ${size} found in ${dir}`;

      const lines = stdout.trim().split('\n').map((l, i) => {
        const parts = l.split('\t');
        const sz    = parts[0] || '';
        const fp    = parts[1] || '';
        return `${i + 1}. \`${sz.padEnd(8)}\` ${fp}`;
      });

      return [`🔍 *Large Files (>${size}) in ${dir}:*`, ``, ...lines].join('\n');
    } catch (err) {
      return `⚠️ Search failed: ${err.message}`;
    }
  }

  /**
   * Find duplicate files in a directory (by size + checksum)
   * @param {object} params
   * @param {string} params.path – directory to scan
   */
  async findDuplicates(params = {}) {
    const dir = params.path || params.dir || os.homedir();
    if (!existsSync(dir)) return `⚠️ Directory not found: ${dir}`;

    try {
      // Group files by size first (fast), then md5 for same-size files
      const { stdout } = await execAsync(
        `find "${dir}" -type f 2>/dev/null | xargs -I{} stat -f "%z %N" "{}" 2>/dev/null | sort -n`,
        { timeout: 30000 }
      );
      const lines   = stdout.trim().split('\n').filter(Boolean);
      const bySize  = {};
      for (const line of lines) {
        const spaceIdx = line.indexOf(' ');
        const size  = line.slice(0, spaceIdx);
        const fpath = line.slice(spaceIdx + 1);
        if (!bySize[size]) bySize[size] = [];
        bySize[size].push(fpath);
      }

      // Only hash files where size appears more than once
      const candidates = Object.entries(bySize)
        .filter(([, files]) => files.length > 1)
        .flatMap(([, files]) => files);

      if (!candidates.length) return `✅ No duplicate files found in ${dir}`;

      // Compute md5 for candidates
      const hashMap = {};
      await Promise.all(candidates.slice(0, 100).map(async (fp) => {
        try {
          const { stdout: h } = await execAsync(`md5 -q "${fp}"`, { timeout: 5000 });
          const hash = h.trim();
          if (!hashMap[hash]) hashMap[hash] = [];
          hashMap[hash].push(fp);
        } catch {}
      }));

      const dupes = Object.values(hashMap).filter(arr => arr.length > 1);
      if (!dupes.length) return `✅ No duplicate files found in ${dir}`;

      const report = dupes.slice(0, 5).map((group, i) => {
        return [`*Group ${i + 1}:*`, ...group.map(f => `  • ${f}`)].join('\n');
      });

      return [
        `🔁 *Duplicate Files in ${dir}:*`,
        `Found ${dupes.length} group(s)`,
        ``,
        ...report,
      ].join('\n');
    } catch (err) {
      return `⚠️ Duplicate search failed: ${err.message}`;
    }
  }

  /**
   * Watch a file/directory for changes using macOS fsevents via `fswatch`
   * Returns a summary of recent changes (or instructions if fswatch not installed)
   */
  async watch(params = {}) {
    const watchPath = params.path || params.dir || process.cwd();
    if (!existsSync(watchPath)) return `⚠️ Path not found: ${watchPath}`;

    try {
      await execAsync('which fswatch');
    } catch {
      return [
        `⚠️ *fswatch* is not installed.`,
        `Install it with: \`brew install fswatch\``,
        ``,
        `Alternatively, I can check for recent file modifications using:`,
        `\`find "${watchPath}" -newer /tmp/.clawbot_watch -type f\``,
      ].join('\n');
    }

    // Use find to show recently modified files (last 24h) as a snapshot
    try {
      const { stdout } = await execAsync(
        `find "${watchPath}" -type f -mtime -1 2>/dev/null | head -20`
      );
      if (!stdout.trim()) return `📁 No files modified in the last 24h in: ${watchPath}`;
      const files = stdout.trim().split('\n').map(f => `• ${f}`);
      return [
        `👁️ *Recent Changes (last 24h): ${watchPath}*`,
        ``,
        ...files,
      ].join('\n');
    } catch (err) {
      return `⚠️ Watch failed: ${err.message}`;
    }
  }

  /**
   * Get a quick directory overview: file count, types, total size
   */
  async overview(params = {}) {
    const dir = params.path || params.dir || process.cwd();
    if (!existsSync(dir)) return `⚠️ Directory not found: ${dir}`;
    try {
      const [total, types, size] = await Promise.all([
        execAsync(`find "${dir}" -type f 2>/dev/null | wc -l`).then(r => r.stdout.trim()),
        execAsync(`find "${dir}" -type f 2>/dev/null | awk -F. 'NF>1{print tolower($NF)}' | sort | uniq -c | sort -rn | head -10`).then(r => r.stdout.trim()),
        execAsync(`du -sh "${dir}" 2>/dev/null`).then(r => r.stdout.split('\t')[0]),
      ]);

      const typeLines = types ? types.split('\n').map(l => {
        const m = l.trim().match(/(\d+)\s+(\S+)/);
        return m ? `  • *.${m[2]}* — ${m[1]} files` : null;
      }).filter(Boolean) : [];

      return [
        `📁 *Directory Overview: ${dir}*`,
        ``,
        `📄 Total files: *${total.trim()}*`,
        `💾 Total size:  *${size}*`,
        typeLines.length ? '\n*File types:*\n' + typeLines.join('\n') : '',
      ].filter(Boolean).join('\n');
    } catch (err) {
      return `⚠️ Overview failed: ${err.message}`;
    }
  }
}
