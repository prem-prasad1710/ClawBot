/**
 * tools/browser.js
 * Playwright-based browser automation.
 * Supports: open, click, fill, scrape, screenshot.
 */

import { chromium } from 'playwright';
import { logger } from '../utils/logger.js';

export class Browser {
  constructor() {
    this._browser = null;
    this._page = null;
  }

  /**
   * Execute a browser operation from an action params object.
   * @param {object} params
   * @param {string} params.operation - open | click | fill | scrape | screenshot | close
   * @param {string} [params.url]
   * @param {string} [params.selector]
   * @param {string} [params.value]
   * @param {string} [params.screenshotPath]
   * @returns {Promise<string>} Human-readable result
   */
  async execute(params) {
    const { operation, url, selector, value, screenshotPath } = params;

    switch (operation) {
      case 'open':
        return this.open(url);
      case 'click':
        return this.click(selector);
      case 'fill':
        return this.fill(selector, value || '');
      case 'scrape':
        return this.scrape(url, selector);
      case 'screenshot':
        return this.screenshot(screenshotPath || '/tmp/clawbot_screenshot.png');
      case 'close':
        return this.close();
      case 'evaluate':
        return this.evaluate(params.script || '');
      default:
        throw new Error(`Unknown browser operation: ${operation}`);
    }
  }

  async open(url) {
    await this._ensureBrowser();
    logger.info(`[Browser] Opening: ${url}`);
    await this._page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await this._page.title();
    const currentUrl = this._page.url();
    return `Opened: ${url}\nTitle: ${title}\nFinal URL: ${currentUrl}`;
  }

  async click(selector) {
    await this._ensurePage();
    logger.info(`[Browser] Clicking: ${selector}`);
    await this._page.click(selector, { timeout: 10000 });
    return `Clicked: ${selector}`;
  }

  async fill(selector, value) {
    await this._ensurePage();
    logger.info(`[Browser] Filling "${selector}" with "${value}"`);
    await this._page.fill(selector, value, { timeout: 10000 });
    return `Filled "${selector}" with "${value}"`;
  }

  async scrape(url, selector) {
    await this._ensureBrowser();
    if (url) {
      await this._page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await this._ensurePage();

    let text;
    if (selector) {
      await this._page.waitForSelector(selector, { timeout: 10000 });
      text = await this._page.$eval(selector, (el) => el.innerText);
    } else {
      text = await this._page.evaluate(() => document.body.innerText);
    }

    const trimmed = text.slice(0, 3000);
    logger.info(`[Browser] Scraped ${trimmed.length} chars`);
    return trimmed;
  }

  async screenshot(filePath) {
    await this._ensurePage();
    await this._page.screenshot({ path: filePath, fullPage: true });
    logger.info(`[Browser] Screenshot saved: ${filePath}`);
    return `Screenshot saved to: ${filePath}`;
  }

  async evaluate(script) {
    await this._ensurePage();
    const result = await this._page.evaluate(script);
    return JSON.stringify(result, null, 2);
  }

  async close() {
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
      this._page = null;
      logger.info('[Browser] Closed.');
    }
    return 'Browser closed.';
  }

  // ── Private ───────────────────────────

  async _ensureBrowser() {
    if (!this._browser) {
      this._browser = await chromium.launch({ headless: true });
      const ctx = await this._browser.newContext();
      this._page = await ctx.newPage();
      logger.info('[Browser] Launched headless Chromium.');
    }
  }

  async _ensurePage() {
    if (!this._page) {
      throw new Error('Browser not open. Use operation "open" first.');
    }
  }
}
