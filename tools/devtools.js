/**
 * tools/devtools.js – Developer Power Tools
 * JWT decoder, UUID generator, Base64 encode/decode, Hash generator,
 * Color converter, JSON formatter, Regex tester, Lorem ipsum, HTTP status lookup,
 * Cron expression explainer, Password generator.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

export class DevTools {
  /**
   * Generate a UUID v4
   */
  uuid(params = {}) {
    const count = Math.min(parseInt(params.count || 1), 20);
    const ids = Array.from({ length: count }, () => randomUUID());
    if (count === 1) return `🔑 *UUID v4:*\n\`${ids[0]}\``;
    return `🔑 *${count} UUIDs:*\n${ids.map(id => `\`${id}\``).join('\n')}`;
  }

  /**
   * Base64 encode or decode
   */
  base64(params = {}) {
    const { text, operation = 'encode' } = params;
    if (!text) return '⚠️ Provide text to encode/decode.';
    try {
      if (operation === 'decode' || operation === 'dec') {
        const decoded = Buffer.from(text, 'base64').toString('utf8');
        return `🔓 *Base64 Decoded:*\n\`\`\`\n${decoded.slice(0, 2000)}\n\`\`\``;
      }
      const encoded = Buffer.from(text, 'utf8').toString('base64');
      return `🔐 *Base64 Encoded:*\n\`\`\`\n${encoded}\n\`\`\``;
    } catch (err) {
      return `⚠️ ${err.message}`;
    }
  }

  /**
   * Generate hash of text (MD5, SHA256, SHA512, SHA1)
   */
  hash(params = {}) {
    const { text, algorithm = 'sha256' } = params;
    if (!text) return '⚠️ Provide text to hash.';
    const algos = algorithm === 'all'
      ? ['md5', 'sha1', 'sha256', 'sha512']
      : [algorithm.toLowerCase()];

    const results = algos.map(algo => {
      try {
        const h = createHash(algo).update(text).digest('hex');
        return `*${algo.toUpperCase()}:* \`${h}\``;
      } catch {
        return `*${algo.toUpperCase()}:* (unsupported)`;
      }
    });

    return [`🔒 *Hash for:* \`${text.slice(0, 50)}\``, ``, ...results].join('\n');
  }

  /**
   * Decode a JWT token (no verification — just parse)
   */
  decodeJwt(params = {}) {
    const token = params.token || params.jwt || '';
    if (!token) return '⚠️ Provide a JWT token.';
    try {
      const parts  = token.split('.');
      if (parts.length !== 3) return '⚠️ Invalid JWT (must have 3 parts).';
      const header  = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // Check expiry
      let expiryInfo = '';
      if (payload.exp) {
        const expDate = new Date(payload.exp * 1000);
        const isExp   = expDate < new Date();
        expiryInfo = `\n⏰ Expires: *${expDate.toLocaleString()}* ${isExp ? '🔴 EXPIRED' : '🟢 Valid'}`;
      }
      if (payload.iat) {
        const iatDate = new Date(payload.iat * 1000);
        expiryInfo += `\n📅 Issued:  *${iatDate.toLocaleString()}*`;
      }

      return [
        `🔑 *JWT Decoded*`,
        ``,
        `*Header:*\n\`\`\`json\n${JSON.stringify(header, null, 2)}\n\`\`\``,
        `*Payload:*\n\`\`\`json\n${JSON.stringify(payload, null, 2).slice(0, 1000)}\n\`\`\``,
        expiryInfo,
      ].filter(Boolean).join('\n');
    } catch (err) {
      return `⚠️ JWT decode failed: ${err.message}`;
    }
  }

  /**
   * Format JSON (pretty-print & validate)
   */
  formatJson(params = {}) {
    const text = params.text || params.json || '';
    if (!text) return '⚠️ Provide JSON to format.';
    try {
      const parsed  = JSON.parse(text);
      const pretty  = JSON.stringify(parsed, null, 2);
      const keys    = Object.keys(parsed).length;
      return [
        `✅ *Valid JSON* — ${keys} top-level keys`,
        ``,
        `\`\`\`json`,
        pretty.slice(0, 2000),
        `\`\`\``,
      ].join('\n');
    } catch (err) {
      // Find error location
      const match = err.message.match(/position (\d+)/);
      const pos   = match ? parseInt(match[1]) : -1;
      const context = pos > 0 ? `…${text.slice(Math.max(0, pos - 10), pos + 10)}…` : '';
      return `❌ *Invalid JSON*\n${err.message}${context ? `\nNear: \`${context}\`` : ''}`;
    }
  }

  /**
   * Generate a secure password
   */
  generatePassword(params = {}) {
    const length  = Math.min(Math.max(parseInt(params.length || 20), 8), 128);
    const symbols = params.symbols !== false;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
                   (symbols ? '!@#$%^&*()_+-=[]{}|;:,.<>?' : '');
    const password = Array.from(
      randomBytes(length),
      byte => charset[byte % charset.length]
    ).join('');

    // Entropy calculation
    const entropy = (Math.log2(charset.length) * length).toFixed(1);

    return [
      `🔐 *Generated Password (${length} chars):*`,
      `\`${password}\``,
      ``,
      `🧮 Entropy: *~${entropy} bits*`,
      `💪 Strength: ${parseFloat(entropy) >= 80 ? '🟢 Very Strong' : parseFloat(entropy) >= 60 ? '🟡 Strong' : '🔴 Weak'}`,
    ].join('\n');
  }

  /**
   * Test a regex pattern against a string
   */
  testRegex(params = {}) {
    const { pattern, text, flags = 'g' } = params;
    if (!pattern) return '⚠️ Provide a regex pattern.';
    if (!text)    return '⚠️ Provide text to test against.';
    try {
      const rx      = new RegExp(pattern, flags);
      const matches = [...(text.matchAll(rx) || [])];
      if (!matches.length) {
        return `🔍 *Regex:* \`${pattern}\`\n\n❌ No matches found in the given text.`;
      }
      const matchList = matches.slice(0, 10).map((m, i) =>
        `${i + 1}. \`${m[0]}\` at index ${m.index}${m.length > 1 ? ' | Groups: ' + m.slice(1).map(g => `\`${g}\``).join(', ') : ''}`
      );
      return [
        `🔍 *Regex:* \`${pattern}\` | flags: \`${flags}\``,
        ``,
        `✅ *${matches.length} match(es):*`,
        ...matchList,
        matches.length > 10 ? `_...and ${matches.length - 10} more_` : '',
      ].filter(Boolean).join('\n');
    } catch (err) {
      return `❌ Invalid regex: ${err.message}`;
    }
  }

  /**
   * Explain a cron expression in human-readable form
   */
  explainCron(params = {}) {
    const expr = params.expression || params.cron || '';
    if (!expr) return '⚠️ Provide a cron expression (e.g. `0 9 * * 1-5`)';

    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) return '⚠️ Cron must have 5 or 6 parts: min hour day month weekday [year]';

    const [min, hour, dom, mon, dow, year] = parts;

    const explain = (val, unit, names) => {
      if (val === '*') return `every ${unit}`;
      if (val.includes('/')) {
        const [, step] = val.split('/');
        return `every ${step} ${unit}s`;
      }
      if (val.includes('-')) {
        const [s, e] = val.split('-');
        if (names) return `${unit}s ${names[s] || s}–${names[e] || e}`;
        return `${unit}s ${s}–${e}`;
      }
      if (val.includes(',')) {
        const vals = val.split(',');
        const named = names ? vals.map(v => names[v] || v) : vals;
        return `${unit}s: ${named.join(', ')}`;
      }
      if (names) return `${unit} ${names[val] || val}`;
      return `${unit} ${val}`;
    };

    const months = { '1':'Jan','2':'Feb','3':'Mar','4':'Apr','5':'May','6':'Jun','7':'Jul','8':'Aug','9':'Sep','10':'Oct','11':'Nov','12':'Dec' };
    const days   = { '0':'Sun','1':'Mon','2':'Tue','3':'Wed','4':'Thu','5':'Fri','6':'Sat','7':'Sun' };

    const lines = [
      `🕐 *Cron Expression:* \`${expr}\``,
      ``,
      `📋 *Explanation:*`,
      `• Minute:     ${explain(min, 'minute', null)}`,
      `• Hour:       ${explain(hour, 'hour', null)}`,
      `• Day/Month:  ${explain(dom, 'day', null)}`,
      `• Month:      ${explain(mon, 'month', months)}`,
      `• Day/Week:   ${explain(dow, 'weekday', days)}`,
      year ? `• Year:       ${explain(year, 'year', null)}` : '',
    ].filter(Boolean);

    return lines.join('\n');
  }

  /**
   * Look up HTTP status code meaning
   */
  httpStatus(params = {}) {
    const code = parseInt(params.code || params.status || 0);
    if (!code) return '⚠️ Provide an HTTP status code.';

    const statuses = {
      100: ['Continue', 'The server has received the request headers.'],
      101: ['Switching Protocols', 'Switching to a different protocol.'],
      200: ['OK', 'The request was successful.'],
      201: ['Created', 'A new resource was successfully created.'],
      204: ['No Content', 'Success, but no content to return.'],
      301: ['Moved Permanently', 'The resource has permanently moved.'],
      302: ['Found', 'Temporary redirect.'],
      304: ['Not Modified', 'Cached version is still valid.'],
      400: ['Bad Request', 'The server could not understand the request.'],
      401: ['Unauthorized', 'Authentication required.'],
      403: ['Forbidden', 'Access denied — no permission.'],
      404: ['Not Found', 'The resource does not exist.'],
      405: ['Method Not Allowed', 'HTTP method not supported for this endpoint.'],
      408: ['Request Timeout', 'The server timed out waiting for the request.'],
      409: ['Conflict', 'Request conflicts with current state of the server.'],
      422: ['Unprocessable Entity', 'Validation error — server understands but can\'t process.'],
      429: ['Too Many Requests', 'Rate limit exceeded.'],
      500: ['Internal Server Error', 'The server encountered an unexpected error.'],
      502: ['Bad Gateway', 'Invalid response from an upstream server.'],
      503: ['Service Unavailable', 'Server is overloaded or in maintenance.'],
      504: ['Gateway Timeout', 'Upstream server timed out.'],
    };

    const info  = statuses[code];
    const emoji = code < 300 ? '✅' : code < 400 ? '↪️' : code < 500 ? '⚠️' : '🔥';
    const cat   = code < 200 ? 'Informational' : code < 300 ? 'Success' : code < 400 ? 'Redirection' : code < 500 ? 'Client Error' : 'Server Error';

    if (!info) return `${emoji} *HTTP ${code}* — ${cat}\n(No detailed description available for this code.)`;
    return `${emoji} *HTTP ${code} — ${info[0]}*\n\n${info[1]}\n\n_Category: ${cat}_`;
  }

  /**
   * URL encode/decode
   */
  urlEncode(params = {}) {
    const { text, operation = 'encode' } = params;
    if (!text) return '⚠️ Provide text to encode/decode.';
    const result = operation === 'decode'
      ? decodeURIComponent(text)
      : encodeURIComponent(text);
    return `🔗 *URL ${operation === 'decode' ? 'Decoded' : 'Encoded'}:*\n\`${result}\``;
  }

  /**
   * Generate Lorem Ipsum text
   */
  lorem(params = {}) {
    const { paragraphs = 1, words } = params;
    const LOREM = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(' ');

    if (words) {
      const w = Math.min(parseInt(words), 500);
      const result = Array.from({ length: w }, (_, i) => LOREM[i % LOREM.length]).join(' ');
      return `📝 *${w} words of Lorem Ipsum:*\n\n${result}`;
    }

    const paras = Math.min(parseInt(paragraphs), 5);
    const result = Array.from({ length: paras }, (_, i) => {
      const start = i * 30;
      return LOREM.slice(start % LOREM.length, (start % LOREM.length) + 40 + i * 10).join(' ') + '.';
    });
    return `📝 *Lorem Ipsum (${paras} paragraph${paras > 1 ? 's' : ''}):*\n\n${result.join('\n\n')}`;
  }

  /**
   * Convert string case: camelCase, snake_case, kebab-case, PascalCase, SCREAMING_SNAKE
   */
  convertCase(params = {}) {
    const { text, to = 'all' } = params;
    if (!text) return '⚠️ Provide text to convert.';

    const words = text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .split(/\s+/)
      .map(w => w.toLowerCase())
      .filter(Boolean);

    const variants = {
      camelCase:    [words[0], ...words.slice(1).map(w => w[0].toUpperCase() + w.slice(1))].join(''),
      PascalCase:   words.map(w => w[0].toUpperCase() + w.slice(1)).join(''),
      snake_case:   words.join('_'),
      'kebab-case': words.join('-'),
      SCREAMING:    words.join('_').toUpperCase(),
      'Title Case': words.map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
      lowercase:    words.join(' '),
      UPPERCASE:    words.join(' ').toUpperCase(),
    };

    if (to !== 'all' && variants[to]) {
      return `🔤 *${to}:* \`${variants[to]}\``;
    }

    const lines = Object.entries(variants).map(([name, val]) => `*${name}:* \`${val}\``);
    return `🔤 *Case Conversions for:* "${text}"\n\n${lines.join('\n')}`;
  }
}
