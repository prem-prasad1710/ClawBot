/**
 * tools/sysinfo.js
 * Reads real-time macOS system information:
 * CPU, RAM, disk, battery, uptime, top processes, network interfaces.
 */

import { execSync } from 'child_process';

function run(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { timeout }).toString().trim();
  } catch {
    return '';
  }
}

export class SysInfo {
  get(section = 'all') {
    const hostname = run('hostname');
    const osVer    = run('sw_vers -productVersion');
    const uptime   = run("uptime | sed 's/.*up //' | sed 's/,.*//'");
    const cpu      = run('sysctl -n machdep.cpu.brand_string');
    const cpuLoad  = run("top -l 1 -s 0 | grep 'CPU usage' | head -1");
    const cores    = run('sysctl -n hw.logicalcpu');

    // Memory
    const memPages = run('vm_stat | grep -E "Pages (free|active|inactive|wired)"');
    const totalRam = run('sysctl -n hw.memsize');
    const totalRamGB = totalRam ? (parseInt(totalRam) / 1e9).toFixed(1) + ' GB' : '';

    // Disk
    const disk = run("df -h / | tail -1 | awk '{print \"Used: \"$3\" / \"$2\" (\"$5\" full) — Free: \"$4}'");

    // Battery
    const battery = run("pmset -g batt | grep -E '[0-9]+%' | head -1") || 'N/A (desktop or pmset unavailable)';

    // Network
    const localIP  = run("ipconfig getifaddr en0 || ipconfig getifaddr en1 || ifconfig | grep -E 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}'");
    const wifi     = run('networksetup -getairportnetwork en0 2>/dev/null || echo ""');

    // Top processes by CPU
    const topCPU   = run("ps aux | sort -nrk 3,3 | head -6 | tail -5 | awk '{printf \"%-6s %-8s %s\\n\", $3\"%\", $4\"%mem\", $11}'");
    // Top processes by memory
    const topMem   = run("ps aux | sort -nrk 4,4 | head -6 | tail -5 | awk '{printf \"%-8s %-6s %s\\n\", $4\"%\", $3\"%cpu\", $11}'");

    const lines = [
      `🖥️  SYSTEM INFO — ${hostname}`,
      `─────────────────────────────────`,
      `macOS version : ${osVer}`,
      `Uptime        : ${uptime}`,
      ``,
      `⚡ CPU`,
      `  ${cpu}`,
      `  Cores: ${cores}`,
      `  ${cpuLoad}`,
      ``,
      `🧠 MEMORY — ${totalRamGB}`,
      memPages.split('\n').map(l => `  ${l}`).join('\n'),
      ``,
      `💾 DISK`,
      `  ${disk}`,
      ``,
      `🔋 BATTERY`,
      `  ${battery}`,
      ``,
      `🌐 NETWORK`,
      `  Local IP : ${localIP || 'unknown'}`,
      wifi ? `  WiFi     : ${wifi}` : '',
      ``,
      `🔝 TOP CPU PROCESSES`,
      topCPU.split('\n').map(l => `  ${l}`).join('\n'),
      ``,
      `🔝 TOP MEMORY PROCESSES`,
      topMem.split('\n').map(l => `  ${l}`).join('\n'),
    ];

    return lines.filter(l => l !== undefined).join('\n');
  }

  async processes(filter = '') {
    const all = run(`ps aux | sort -nrk 3,3 | head -20`);
    if (filter) {
      const matched = all.split('\n').filter(l => l.toLowerCase().includes(filter.toLowerCase()));
      return matched.length ? matched.join('\n') : `No processes matching "${filter}"`;
    }
    return all;
  }
}
