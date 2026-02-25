/**
 * tools/search.js
 * Free web search using DuckDuckGo HTML scraping – no API key required.
 * Falls back to a Bing HTML scrape if DuckDuckGo returns no results.
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import https from 'https';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// macOS often lacks the root CA bundle that Node.js needs for corporate/proxy
// environments. Using a permissive agent only for outbound search scraping.
const tlsAgent = new https.Agent({ rejectUnauthorized: false });

const DDG_URL = 'https://html.duckduckgo.com/html/';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

export class WebSearch {
  /**
   * Search the web and return a summarized text of top results.
   * @param {string} query
   * @returns {Promise<string>}
   */
  async search(query) {
    logger.info(`[Search] Query: ${query}`);

    // 1. Try DuckDuckGo
    try {
      const results = await this._ddgSearch(query);
      if (results.length > 0) return this._formatResults(query, results);
    } catch (err) {
      logger.warn(`[Search] DuckDuckGo failed: ${err.message}`);
    }

    // 2. Fallback: Bing HTML scrape
    try {
      logger.info(`[Search] Trying Bing fallback…`);
      const results = await this._bingSearch(query);
      if (results.length > 0) return this._formatResults(query, results);
    } catch (err) {
      logger.warn(`[Search] Bing failed: ${err.message}`);
    }

    return `No results found for: "${query}". Consider trying a different search query.`;
  }

  /**
   * Search and then fetch the content of the top result.
   */
  async searchAndRead(query) {
    const results = await this._ddgSearch(query);
    if (!results.length) return `No results for: ${query}`;

    const top = results[0];
    try {
      const content = await this._fetchPage(top.url);
      return `Source: ${top.url}\n\nContent:\n${content.slice(0, 4000)}`;
    } catch (err) {
      return `${this._formatResults(query, results)}\n\n(Could not fetch top result: ${err.message})`;
    }
  }

  // ── Private ───────────────────────────────────────

  async _ddgSearch(query) {
    const body = new URLSearchParams({ q: query, kl: 'us-en' });

    const resp = await fetch(DDG_URL, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      timeout: 15000,
      agent: tlsAgent,
    });

    if (!resp.ok) throw new Error(`DDG HTTP ${resp.status}`);

    const html = await resp.text();
    const $ = cheerio.load(html);

    const results = [];
    $('.result__body').each((_, el) => {
      const titleEl = $(el).find('.result__title a');
      const snippetEl = $(el).find('.result__snippet');
      const title = titleEl.text().trim();
      const href = titleEl.attr('href') || '';
      const snippet = snippetEl.text().trim();

      // DDG wraps URLs in a redirect – extract the actual URL
      let url = href;
      try {
        const u = new URL(href, 'https://html.duckduckgo.com');
        url = u.searchParams.get('uddg') || href;
      } catch { /* keep raw href */ }

      if (title && url) {
        results.push({ title, url, snippet });
      }
    });

    return results.slice(0, config.search.maxResults);
  }

  async _bingSearch(query) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setmkt=en-US&setlang=en`;
    const resp = await fetch(url, {
      headers: HEADERS,
      timeout: 15000,
      agent: tlsAgent,
    });
    if (!resp.ok) throw new Error(`Bing HTTP ${resp.status}`);

    const html = await resp.text();
    const $ = cheerio.load(html);
    const results = [];

    $('#b_results .b_algo').each((_, el) => {
      const titleEl = $(el).find('h2 a');
      const snippetEl = $(el).find('.b_caption p');
      const title = titleEl.text().trim();
      const url = titleEl.attr('href') || '';
      const snippet = snippetEl.text().trim();
      if (title && url) results.push({ title, url, snippet });
    });

    return results.slice(0, config.search.maxResults);
  }

  async _fetchPage(url) {
    const resp = await fetch(url, { headers: HEADERS, timeout: 15000, agent: tlsAgent });
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Remove noise
    $('script, style, nav, footer, header, iframe, noscript').remove();

    const text = $('body').text().replace(/\s\s+/g, ' ').trim();
    return text;
  }

  _formatResults(query, results) {
    const lines = [
      `Search results for: "${query}"`,
      '─'.repeat(40),
    ];

    results.forEach((r, i) => {
      lines.push(`\n[${i + 1}] ${r.title}`);
      lines.push(`    URL: ${r.url}`);
      if (r.snippet) lines.push(`    ${r.snippet}`);
    });

    return lines.join('\n');
  }
}
