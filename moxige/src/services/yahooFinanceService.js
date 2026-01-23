// Yahoo Finance API Service for Polish Stocks
// Provides real-time and historical data for BMV (Polish Stock Exchange) stocks

class YahooFinanceService {
  constructor() {
    // Prefer backend proxy in all environments; add local fallback for preview server without proxy
    const primary = '/api/yf/v8/finance/chart/';
    const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
    const isLocal = /^(localhost|127\.0\.0\.1)$/.test(host) || /^192\./.test(host) || /^172\./.test(host);
    const fallback = 'http://127.0.0.1:5210/api/yf/v8/finance/chart/';
    this.baseCandidates = isLocal ? [primary, fallback] : [primary];
    this.baseUrl = primary;
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache
  }

  /**
   * Get current stock price and basic info
   * @param {string} symbol - Stock symbol (e.g., 'PKO.WA', 'PKN.WA')
   * @returns {Promise<Object>} Stock data
   */
  async getCurrentPrice(symbol) {
    const cacheKey = `current_${symbol}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const data = await this.fetchJsonWithFallback(`${symbol}?interval=1d&range=1d`);
      const result = data.chart.result[0];
      const meta = result.meta;
      const quote = result.indicators.quote[0];

      const stockData = {
        symbol: symbol,
        price: meta.regularMarketPrice || meta.previousClose,
        change: meta.regularMarketPrice - meta.previousClose,
        changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
        volume: meta.regularMarketVolume,
        marketCap: meta.marketCap,
        currency: meta.currency,
        exchangeName: meta.exchangeName,
        timestamp: new Date(meta.regularMarketTime * 1000),
        high: quote.high[quote.high.length - 1],
        low: quote.low[quote.low.length - 1],
        open: quote.open[quote.open.length - 1],
        previousClose: meta.previousClose
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: stockData,
        timestamp: Date.now()
      });

      return stockData;
    } catch (error) {
      // Fallback: PKO.WA may be unavailable on Yahoo; try PKO.WA
      if (/PKO\.WA$/i.test(symbol)) {
        try {
          const fb = 'PKO.WA';
          const data = await this.fetchJsonWithFallback(`${fb}?interval=1d&range=1d`);
          const result = data.chart.result[0];
          const meta = result.meta;
          const quote = result.indicators.quote[0];

          const stockData = {
            symbol: fb,
            price: meta.regularMarketPrice || meta.previousClose,
            change: meta.regularMarketPrice - meta.previousClose,
            changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
            volume: meta.regularMarketVolume,
            marketCap: meta.marketCap,
            currency: meta.currency,
            exchangeName: meta.exchangeName,
            timestamp: new Date(meta.regularMarketTime * 1000),
            high: quote.high[quote.high.length - 1],
            low: quote.low[quote.low.length - 1],
            open: quote.open[quote.open.length - 1],
            previousClose: meta.previousClose
          };
          this.cache.set(cacheKey, { data: stockData, timestamp: Date.now() });
          return stockData;
        } catch (e2) {
          console.error(`Fallback fetch data for PKO.WA failed:`, e2);
        }
      }
      console.error(`Error fetching data for ${symbol}:`, error);
      throw new Error(`Failed to fetch data for ${symbol}: ${error.message}`);
    }
  }

  /**
   * Get historical stock data
   * @param {string} symbol - Stock symbol
   * @param {string} period - Time period ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max')
   * @param {string} interval - Data interval ('1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo')
   * @returns {Promise<Object>} Historical data
   */
  async getHistoricalData(symbol, period = '1mo', interval = '1d') {
    const cacheKey = `historical_${symbol}_${period}_${interval}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout * 5) { // 5 minute cache for historical data
      return cached.data;
    }

    try {
      const data = await this.fetchJsonWithFallback(`${symbol}?interval=${interval}&range=${period}`);
      const result = data.chart.result[0];
      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];

      const historicalData = {
        symbol: symbol,
        currency: result.meta.currency,
        exchangeName: result.meta.exchangeName,
        data: timestamps.map((timestamp, index) => ({
          date: new Date(timestamp * 1000),
          open: quote.open[index],
          high: quote.high[index],
          low: quote.low[index],
          close: quote.close[index],
          volume: quote.volume[index]
        })).filter(item => item.close !== null) // Filter out null values
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: historicalData,
        timestamp: Date.now()
      });

      return historicalData;
    } catch (error) {
      // Fallback for PKO.WA → PKO.WA when Yahoo returns 404/Not Found
      if (/PKO\.WA$/i.test(symbol)) {
        try {
          const fb = 'PKO.WA';
          const data = await this.fetchJsonWithFallback(`${fb}?interval=${interval}&range=${period}`);
          const result = data.chart.result[0];
          const timestamps = result.timestamp;
          const quote = result.indicators.quote[0];
          const historicalData = {
            symbol: fb,
            currency: result.meta.currency,
            exchangeName: result.meta.exchangeName,
            data: timestamps.map((timestamp, index) => ({
              date: new Date(timestamp * 1000),
              open: quote.open[index],
              high: quote.high[index],
              low: quote.low[index],
              close: quote.close[index],
              volume: quote.volume[index]
            })).filter(item => item.close !== null)
          };
          this.cache.set(`historical_${fb}_${period}_${interval}`, { data: historicalData, timestamp: Date.now() });
          return historicalData;
        } catch (e2) {
          console.error(`Fallback historical fetch for PKO.WA failed:`, e2);
        }
      }
      console.error(`Error fetching historical data for ${symbol}:`, error);
      throw new Error(`Failed to fetch historical data for ${symbol}: ${error.message}`);
    }
  }

  /**
   * Get multiple stocks data at once
   * @param {Array<string>} symbols - Array of stock symbols
   * @returns {Promise<Array<Object>>} Array of stock data
   */
  async getMultipleStocks(symbols) {
    try {
      const q = await this.fetchBatchQuotesWithFallback(symbols);
      const arr = Array.isArray(q?.quoteResponse?.result) ? q.quoteResponse.result : [];
      return arr.map(r => ({
        symbol: r.symbol,
        price: r.regularMarketPrice ?? r.postMarketPrice ?? r.preMarketPrice ?? r.previousClose,
        change: (r.regularMarketChange ?? 0),
        changePercent: (r.regularMarketChangePercent ?? 0),
        volume: r.regularMarketVolume ?? r.averageDailyVolume3Month ?? 0,
        currency: r.currency,
        exchangeName: r.fullExchangeName || r.exchange,
        timestamp: r.regularMarketTime ? new Date(r.regularMarketTime * 1000) : new Date(),
        high: r.regularMarketDayHigh,
        low: r.regularMarketDayLow,
        open: r.regularMarketOpen,
        previousClose: r.previousClose,
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get Polish stock symbols mapping
   * @returns {Object} Symbol mapping for Polish stocks
   */
  getPolishStockSymbols() {
    return {
      'PKO': 'PKO.WA',
      'PKN': 'PKN.WA',
      'PKN/CPO': 'PKN.WA',
      'PKO': 'PKO.WA',
      'PKO': 'PKO.WA',
      'BIMBO/A': 'PZU.WA',
      'KGH': 'KGH.WA',
      'GFNORTE': 'CDR.WA',
      'FEMSA': 'ALR.WA',
      'TLEVISA': 'LPP.WA',
      'DNP': 'DNP.WA'
    };
  }

  /**
   * Convert internal symbol to Yahoo Finance symbol
   * @param {string} symbol - Internal symbol
   * @returns {string} Yahoo Finance symbol
   */
  convertToYahooSymbol(symbol) {
    const mapping = this.getPolishStockSymbols();
    const s = String(symbol || '').trim();
    if (!s) return '';
    // Avoid double suffix or already Yahoo-style input
    if (/\.WA$/i.test(s)) return s;
    return mapping[s] || `${s}.WA`;
  }

  // Internal: fetch JSON with local fallback when preview server lacks proxy
  async fetchJsonWithFallback(path) {
    let lastErr;
    for (const base of this.baseCandidates) {
      try {
        const url = `${base}${path}`;
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ct = response.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Invalid content type');
        const data = await response.json();
        return data;
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
    throw lastErr || new Error('Network error');
  }

  // Internal: v7 batch quote with local fallback
  async fetchBatchQuotesWithFallback(symbols) {
    const joined = encodeURIComponent((Array.isArray(symbols) ? symbols : []).join(','));
    const bases = this.baseCandidates.map((b) => b.replace(/v8\/finance\/chart\/?$/, 'v7/finance/quote?symbols='));
    let lastErr;
    for (const base of bases) {
      try {
        const url = `${base}${joined}`;
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ct = response.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Invalid content type');
        const data = await response.json();
        return data;
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) throw new Error('Invalid content type');
      const data = await res.json();
      return data;
    } catch (e2) {
      return { quoteResponse: { result: [] } };
    }
  }
}

// Export singleton instance
export default new YahooFinanceService();
