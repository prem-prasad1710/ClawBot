/**
 * tools/compress.js
 * Compress and extract archives: zip, unzip, tar.gz, untar.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

function run(cmd, timeout = 60000) {
  const result = execSync(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 });
  return result.toString().trim();
}

export class Compress {
  /**
   * Create a ZIP archive.
   * @param {string} source   Path to file or folder to compress.
   * @param {string} output   Output .zip path (optional — defaults to source.zip).
   */
  zip(source, output) {
    if (!source) return 'ERROR: Provide a source path.';
    if (!existsSync(source)) return `Source not found: ${source}`;
    const out = output || `${source}.zip`;
    run(`zip -r "${out}" "${source}"`);
    const size = run(`du -sh "${out}" | cut -f1`);
    return `✅ Created ZIP: ${out} (${size})`;
  }

  /**
   * Extract a ZIP archive.
   * @param {string} source   Path to .zip file.
   * @param {string} dest     Destination folder (optional — defaults to source dir).
   */
  unzip(source, dest) {
    if (!source) return 'ERROR: Provide a source .zip path.';
    if (!existsSync(source)) return `File not found: ${source}`;
    const destDir = dest || source.replace(/\.zip$/, '');
    run(`unzip -o "${source}" -d "${destDir}"`);
    return `✅ Extracted to: ${destDir}`;
  }

  /**
   * Create a .tar.gz archive.
   */
  tar(source, output) {
    if (!source) return 'ERROR: Provide a source path.';
    if (!existsSync(source)) return `Source not found: ${source}`;
    const out = output || `${source}.tar.gz`;
    run(`tar -czf "${out}" "${source}"`);
    const size = run(`du -sh "${out}" | cut -f1`);
    return `✅ Created tar.gz: ${out} (${size})`;
  }

  /**
   * Extract a .tar.gz / .tar.bz2 / .tar archive.
   */
  untar(source, dest = '.') {
    if (!source) return 'ERROR: Provide a source archive path.';
    if (!existsSync(source)) return `File not found: ${source}`;
    run(`tar -xf "${source}" -C "${dest}"`);
    return `✅ Extracted to: ${dest}`;
  }

  /**
   * List contents of an archive without extracting.
   */
  list(archivePath) {
    if (!existsSync(archivePath)) return `File not found: ${archivePath}`;
    if (archivePath.endsWith('.zip')) {
      return run(`unzip -l "${archivePath}"`);
    }
    return run(`tar -tf "${archivePath}"`);
  }
}
