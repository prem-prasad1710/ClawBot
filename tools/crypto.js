/**
 * tools/crypto.js – Real-time crypto & stock price tool
 * Crypto: CoinGecko free API (no key needed)
 * Stocks: Yahoo Finance public API (no key needed)
 */
import { logger } from '../utils/logger.js';

const COIN_MAP = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana',
  bnb: 'binancecoin',
  xrp: 'ripple', ripple: 'ripple',
  ada: 'cardano', cardano: 'cardano',
  doge: 'dogecoin', dogecoin: 'dogecoin',
  dot: 'polkadot', polkadot: 'polkadot',
  matic: 'matic-network', polygon: 'matic-network',
  avax: 'avalanche-2', avalanche: 'avalanche-2',
  link: 'chainlink', chainlink: 'chainlink',
  ltc: 'litecoin', litecoin: 'litecoin',
  uni: 'uniswap', uniswap: 'uniswap',
  atom: 'cosmos', cosmos: 'cosmos',
  shib: 'shiba-inu',
};

export class CryptoPriceTool {
  /**
   * Get price(s) for one or more crypto coins or stock tickers.
   * @param {object} params
   * @param {string} params.coin   – "btc", "eth,sol,bnb", or "AAPL" for stocks
   * @param {string} params.vs     – vs currency, default "usd"
   * @param {string} params.type   – "crypto" | "stock" | "auto" (default)
   */
  async price(params = {}) {
    const { coin = 'btc', vs = 'usd', type = 'auto' } = params;
    const coins = coin.split(',').map(s => s.trim().toLowerCase());

    // Detect if it's a stock ticker (all uppercase, 1-5 letters like AAPL, MSFT)
    const looksLikeStock = /^[A-Z]{1,5}$/.test(coin.trim());
    const effectiveType  = type === 'auto' ? (looksLikeStock ? 'stock' : 'crypto') : type;

    if (effectiveType === 'stock') {
      return await this._getStockPrice(coin.trim().toUpperCase());
    }
    return await this._getCryptoPrice(coins, vs);
  }

  async _getCryptoPrice(coins, vs = 'usd') {
    const { default: fetch } = await import('node-fetch');
    const ids = coins.map(c => COIN_MAP[c] || c).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;

    try {
      const res = await fetch(url, { timeout: 12000 });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const data = await res.json();

      if (!Object.keys(data).length) {
        return `⚠️ No data found for: ${coins.join(', ')}\nCheck the symbol and try again.`;
      }

      const lines = Object.entries(data).map(([id, info]) => {
        const price   = info[vs];
        const change  = info[`${vs}_24h_change`];
        const vol     = info[`${vs}_24h_vol`];
        const mcap    = info[`${vs}_market_cap`];
        const changeEmoji = change >= 0 ? '📈' : '📉';
        const changeStr   = change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '?';
        const priceStr    = price >= 1 ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${price.toFixed(6)}`;
        const volStr      = vol     ? `Vol: $${formatBig(vol)}`  : '';
        const mcapStr     = mcap    ? `MCap: $${formatBig(mcap)}` : '';
        // Reverse-lookup short symbol from COIN_MAP
        const symbol = Object.entries(COIN_MAP).find(([, v]) => v === id)?.[0]?.toUpperCase() || id.toUpperCase();
        return [
          `*${symbol}* — ${priceStr} ${changeEmoji} ${changeStr} (24h)`,
          volStr || mcapStr ? `  ${[volStr, mcapStr].filter(Boolean).join('  |  ')}` : null,
        ].filter(Boolean).join('\n');
      });

      return `💰 *Crypto Prices (${vs.toUpperCase()})*\n\n${lines.join('\n\n')}`;
    } catch (err) {
      logger.warn(`[Crypto] Error: ${err.message}`);
      return `⚠️ Could not fetch crypto price: ${err.message}`;
    }
  }

  async _getStockPrice(ticker) {
    const { default: fetch } = await import('node-fetch');
    // Yahoo Finance public quote endpoint
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    try {
      const res = await fetch(url, {
        timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) return `⚠️ No data found for ticker: ${ticker}`;

      const price    = meta.regularMarketPrice;
      const prev     = meta.chartPreviousClose;
      const change   = price - prev;
      const changePct = (change / prev) * 100;
      const hi       = meta.regularMarketDayHigh;
      const lo       = meta.regularMarketDayLow;
      const vol      = meta.regularMarketVolume;
      const mcap     = meta.marketCap;
      const name     = meta.longName || ticker;
      const currency = meta.currency || 'USD';
      const exchange = meta.fullExchangeName || '';

      const changeEmoji = change >= 0 ? '📈' : '📉';

      return [
        `📊 *${name}* (${ticker})`,
        `Exchange: ${exchange} | Currency: ${currency}`,
        ``,
        `💵 Price:   *$${price?.toFixed(2)}* ${changeEmoji} ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct.toFixed(2)}%)`,
        `📅 Day Hi:  $${hi?.toFixed(2)}  |  Day Lo: $${lo?.toFixed(2)}`,
        `📦 Volume:  ${formatBig(vol)}`,
        mcap ? `💼 Mkt Cap: $${formatBig(mcap)}` : '',
      ].filter(Boolean).join('\n');
    } catch (err) {
      logger.warn(`[Stock] Error: ${err.message}`);
      return `⚠️ Could not fetch stock price for ${ticker}: ${err.message}`;
    }
  }

  /**
   * Get top N crypto by market cap
   */
  async top(params = {}) {
    const n = Math.min(parseInt(params.n || params.limit || 10), 20);
    const vs = params.vs || 'usd';
    const { default: fetch } = await import('node-fetch');
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${n}&page=1&price_change_percentage=24h`;
    try {
      const res = await fetch(url, { timeout: 12000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const lines = data.map((coin, i) => {
        const pct   = coin.price_change_percentage_24h;
        const emoji = pct >= 0 ? '📈' : '📉';
        const p     = coin.current_price >= 1
          ? `$${coin.current_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
          : `$${coin.current_price.toFixed(6)}`;
        return `${i + 1}. *${coin.symbol.toUpperCase()}* — ${p} ${emoji} ${pct?.toFixed(2)}%`;
      });

      return `🏆 *Top ${n} Crypto by Market Cap*\n\n${lines.join('\n')}`;
    } catch (err) {
      return `⚠️ Could not fetch top coins: ${err.message}`;
    }
  }

  /**
   * Show a simple sparkline-style price chart for a coin (last 7 days)
   */
  async chart(params = {}) {
    const coinRaw = params.coin || params.symbol || 'bitcoin';
    const coinId  = COIN_MAP[coinRaw.toLowerCase()] || coinRaw.toLowerCase();
    const vs      = params.vs || 'usd';
    const { default: fetch } = await import('node-fetch');
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${vs}&days=7&interval=daily`;
    try {
      const res = await fetch(url, { timeout: 12000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const prices = (data.prices || []).map(([, p]) => p);
      if (!prices.length) return `⚠️ No chart data for ${coinRaw}`;

      const min  = Math.min(...prices);
      const max  = Math.max(...prices);
      const range = max - min || 1;
      const height = 5;
      const width  = prices.length;

      // Build ASCII chart
      const normalized = prices.map(p => Math.round(((p - min) / range) * (height - 1)));
      const grid = Array.from({ length: height }, () => Array(width).fill(' '));
      normalized.forEach((h, x) => { grid[height - 1 - h][x] = '●'; });

      const chartLines = grid.map((row, i) => {
        const label = i === 0 ? `$${formatBig(max)}` : i === height - 1 ? `$${formatBig(min)}` : '     ';
        return `${label.padEnd(12)} │${row.join('')}`;
      });

      const change = ((prices[prices.length - 1] - prices[0]) / prices[0] * 100).toFixed(2);
      const symbol  = coinRaw.toUpperCase();

      return [
        `📈 *${symbol} — 7-Day Chart*`,
        ``,
        ...chartLines,
        `             └${'─'.repeat(width)}`,
        `             7d ago     Now`,
        ``,
        `Change: ${parseFloat(change) >= 0 ? '+' : ''}${change}% over 7 days`,
      ].join('\n');
    } catch (err) {
      return `⚠️ Could not generate chart: ${err.message}`;
    }
  }
}

function formatBig(n) {
  if (!n) return '0';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2)  + 'K';
  return n.toFixed(2);
}
