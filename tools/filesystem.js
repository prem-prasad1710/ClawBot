/**
 * tools/filesystem.js
 * File and directory operations + project context builder.
 */

import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { glob } from 'glob';
import ignore from 'ignore';
import { logger } from '../utils/logger.js';

// Max chars to include per source file when building context
const MAX_FILE_CHARS = 3000;
// Max total project context chars
const MAX_CTX_CHARS = 12000;

// Extensions considered source files
const SOURCE_EXTS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java',
  '.c', '.cpp', '.cs', '.rb', '.php', '.swift', '.kt',
  '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.toml',
  '.md', '.sh', '.env.example',
]);

export class FileSystem {
  /**
   * Read a file or list directory contents.
   */
  async read(targetPath) {
    const abs = path.resolve(targetPath);

    if (!fs.existsSync(abs)) {
      return `Path not found: ${abs}`;
    }

    const stat = fs.statSync(abs);

    if (stat.isDirectory()) {
      return this._listDir(abs);
    }

    try {
      const content = fs.readFileSync(abs, 'utf8');
      return content.length > 20000
        ? content.slice(0, 20000) + '\n…[truncated]'
        : content;
    } catch (err) {
      return `Cannot read file: ${err.message}`;
    }
  }

  /**
   * Write content to a file, creating directories as needed.
   */
  async write(filePath, content) {
    const abs = path.resolve(filePath);
    await fsExtra.ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, content, 'utf8');
    logger.info(`[FS] Wrote ${abs} (${content.length} chars)`);
  }

  /**
   * Delete a file or directory (with safety check).
   */
  async delete(targetPath) {
    const abs = path.resolve(targetPath);
    if (abs === '/' || abs === process.env.HOME) {
      throw new Error('Refusing to delete root or home directory.');
    }
    await fsExtra.remove(abs);
    logger.info(`[FS] Deleted: ${abs}`);
    return `Deleted: ${abs}`;
  }

  /**
   * Build a compact project context string for the AI brain.
   * Includes folder tree, key config files, and source files.
   */
  async gatherProjectContext(dir) {
    if (!fs.existsSync(dir)) {
      return `Workspace directory does not exist yet: ${dir}`;
    }

    const ig = ignore();
    const gitignorePath = path.join(dir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, 'utf8'));
    }
    ig.add(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '*.lock']);

    const parts = [`WORKSPACE: ${dir}\n`];
    let totalChars = parts[0].length;

    // 1. Folder tree (depth 3)
    const tree = this._buildTree(dir, dir, ig, 0, 3);
    const treeSection = `FOLDER STRUCTURE:\n${tree}\n`;
    parts.push(treeSection);
    totalChars += treeSection.length;

    // 2. Key project files
    const keyFiles = ['package.json', 'requirements.txt', 'Cargo.toml', 'go.mod',
      'README.md', 'Makefile', 'docker-compose.yml', '.env.example'];

    for (const kf of keyFiles) {
      if (totalChars >= MAX_CTX_CHARS) break;
      const kfPath = path.join(dir, kf);
      if (fs.existsSync(kfPath)) {
        try {
          const content = fs.readFileSync(kfPath, 'utf8').slice(0, MAX_FILE_CHARS);
          const section = `\n--- ${kf} ---\n${content}\n`;
          parts.push(section);
          totalChars += section.length;
        } catch { /* skip */ }
      }
    }

    // 3. Source files (limited)
    const allFiles = await glob('**/*', {
      cwd: dir,
      nodir: true,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '**/*.lock'],
    });

    for (const relPath of allFiles) {
      if (totalChars >= MAX_CTX_CHARS) break;
      if (ig.ignores(relPath)) continue;
      const ext = path.extname(relPath).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      if (keyFiles.includes(relPath)) continue;

      const abs = path.join(dir, relPath);
      try {
        const content = fs.readFileSync(abs, 'utf8').slice(0, MAX_FILE_CHARS);
        const section = `\n--- ${relPath} ---\n${content}\n`;
        parts.push(section);
        totalChars += section.length;
      } catch { /* skip */ }
    }

    return parts.join('');
  }

  // ── Private helpers ───────────────────────────────

  _listDir(dirPath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const lines = entries
        .filter((e) => !['node_modules', '.git', 'dist', 'build'].includes(e.name))
        .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
      return `Directory: ${dirPath}\n${lines.join('\n')}`;
    } catch (err) {
      return `Cannot list directory: ${err.message}`;
    }
  }

  _buildTree(baseDir, currentDir, ig, depth, maxDepth) {
    if (depth > maxDepth) return '';
    const indent = '  '.repeat(depth);
    let result = '';
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = path.relative(baseDir, path.join(currentDir, entry.name));
        if (ig.ignores(rel)) continue;
        if (entry.isDirectory()) {
          result += `${indent}${entry.name}/\n`;
          result += this._buildTree(baseDir, path.join(currentDir, entry.name), ig, depth + 1, maxDepth);
        } else {
          result += `${indent}${entry.name}\n`;
        }
      }
    } catch { /* skip unreadable dirs */ }
    return result;
  }
}
