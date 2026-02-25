/**
 * tools/network.js
 * Network utilities: IP info, ping, DNS lookup, port scan, WiFi status,
 * speed test (fast.com via curl), and HTTP requests.
 */

import { execSync } from 'child_process';
import axios from 'axios';

function run(cmd, timeout = 8000) {
  try {
    return execSync(cmd, { timeout }).toString().trim();
  } catch (e) {
    return `Error: ${e.message.split('\n')[0]}`;
  }
}

export class NetworkTools {
  /**
   * Get local + public IP address and geolocation.
   */
  async myip() {
    const local = run("ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || ifconfig | grep -E 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}'");
    let publicIP = '';
    let geo = '';
    try {
      const resp = await axios.get('https://ipapi.co/json/', { timeout: 8000 });
      const d = resp.data;
      publicIP = d.ip || '';
      geo = d.city && d.country_name ? `${d.city}, ${d.region}, ${d.country_name}` : '';
    } catch {
      try {
        publicIP = run('curl -s --max-time 5 https://ifconfig.me');
      } catch { publicIP = 'unavailable'; }
    }
    return [
      `🌐 Network Info`,
      `─────────────────`,
      `Local IP  : ${local || 'unavailable'}`,
      `Public IP : ${publicIP || 'unavailable'}`,
      geo ? `Location  : ${geo}` : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * Ping a host and return latency stats.
   */
  ping(host, count = 4) {
    if (!host) return 'ERROR: Provide a host to ping.';
    const out = run(`ping -c ${count} -W 2000 "${host}"`, 20000);
    if (out.startsWith('Error:')) return `Cannot reach ${host}`;
    const statsLine = out.split('\n').find(l => l.includes('round-trip') || l.includes('avg')) || '';
    const lossLine  = out.split('\n').find(l => l.includes('packet loss')) || '';
    return `🏓 Ping ${host}:\n${lossLine}\n${statsLine}`.trim();
  }

  /**
   * DNS lookup for a domain.
   */
  dns(domain) {
    if (!domain) return 'ERROR: Provide a domain.';
    const nslookup = run(`nslookup "${domain}"`, 8000);
    const dig      = run(`dig +short "${domain}" 2>/dev/null | head -10`, 8000);
    return `🔍 DNS lookup: ${domain}\n${nslookup}\n${dig ? '\nA records:\n' + dig : ''}`.trim();
  }

  /**
   * List open/listening ports on this machine.
   */
  ports(filter = '') {
    const out = run(`lsof -i -n -P 2>/dev/null | grep LISTEN | head -30`, 10000);
    if (!out || out.startsWith('Error')) {
      return run(`netstat -an | grep LISTEN | head -20`, 8000);
    }
    if (filter) {
      const filtered = out.split('\n').filter(l => l.toLowerCase().includes(filter.toLowerCase()));
      return filtered.length ? filtered.join('\n') : `No ports matching "${filter}"`;
    }
    return out;
  }

  /**
   * Get current WiFi network info.
   */
  wifi() {
    const basic  = run('networksetup -getairportnetwork en0 2>/dev/null');
    const power  = run('networksetup -getairportpower en0 2>/dev/null');
    const info   = run('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I 2>/dev/null');
    return [`📶 WiFi`, basic, power, info].filter(Boolean).join('\n');
  }

  /**
   * Make an HTTP request and return the response.
   * @param {string} url
   * @param {string} method  GET|POST|HEAD
   * @param {object} body    JSON body for POST
   */
  async httpRequest(url, method = 'GET', body = null, headers = {}) {
    try {
      const resp = await axios({
        method: method.toUpperCase(),
        url,
        data:    body,
        headers: { 'User-Agent': 'ClawBot/2.0', ...headers },
        timeout: 15000,
        validateStatus: () => true,
      });
      const preview = typeof resp.data === 'object'
        ? JSON.stringify(resp.data, null, 2).slice(0, 3000)
        : String(resp.data).slice(0, 3000);
      return (
        `🌐 ${method} ${url}\n` +
        `Status: ${resp.status} ${resp.statusText}\n` +
        `Headers: ${JSON.stringify(resp.headers, null, 2).slice(0, 500)}\n\n` +
        `Body:\n${preview}`
      );
    } catch (e) {
      return `HTTP request failed: ${e.message}`;
    }
  }
}
