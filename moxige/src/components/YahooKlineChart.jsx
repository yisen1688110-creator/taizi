import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import yahooFinanceService from '../services/yahooFinanceService';
import '../styles/native-kline.css';

/**
 * Yahoo Finance K线图组件 - TradingView 风格
 * 用于波兰股票（WSE）
 */
const YahooKlineChart = memo(({ symbol, height = 400, onPriceUpdate }) => {
  const canvasRef = useRef(null);
  const dataRef = useRef([]);
  const priceRef = useRef(null);
  const frameRef = useRef(null);
  const intervalRef = useRef(null);
  const mountedRef = useRef(true);
  
  const [timeframe, setTimeframe] = useState('1D');
  const [stats, setStats] = useState({ price: 0, change: 0, high: 0, low: 0, vol: 0 });
  const [ohlc, setOhlc] = useState({ o: 0, h: 0, l: 0, c: 0, vol: 0 });
  const [viewRange, setViewRange] = useState({ start: 0, end: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, start: 0 });
  const [crosshair, setCrosshair] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const [currency, setCurrency] = useState('PLN');

  const colors = {
    bg: '#131722',
    grid: '#1e222d',
    text: '#787b86',
    textLight: '#d1d4dc',
    up: '#26a69a',
    down: '#ef5350',
    upLight: 'rgba(38, 166, 154, 0.5)',
    downLight: 'rgba(239, 83, 80, 0.5)',
  };

  // 获取 Yahoo Finance 符号
  const getYahooSymbol = useCallback(() => {
    const s = String(symbol || '').trim();
    if (!s) return '';
    // 添加 .WA 后缀（华沙证券交易所）
    if (/\.WA$/i.test(s)) return s;
    return `${s}.WA`;
  }, [symbol]);

  const getDisplaySymbol = useCallback(() => {
    return String(symbol || '').replace(/\.WA$/i, '').trim();
  }, [symbol]);

  // Yahoo 时间范围映射
  const getYahooPeriod = useCallback((tf) => {
    const map = {
      '1m': { period: '1d', interval: '1m' },
      '30m': { period: '5d', interval: '30m' },
      '1h': { period: '5d', interval: '1h' },
      '1D': { period: '3mo', interval: '1d' },
      '1W': { period: '1y', interval: '1wk' }
    };
    return map[tf] || { period: '3mo', interval: '1d' };
  }, []);

  // 加载 K 线数据
  const loadKlines = useCallback(async () => {
    const yahooSymbol = getYahooSymbol();
    if (!yahooSymbol) return;
    
    const { period, interval } = getYahooPeriod(timeframe);
    console.log('[YahooChart] Loading:', yahooSymbol, period, interval);
    
    try {
      const data = await yahooFinanceService.getHistoricalData(yahooSymbol, period, interval);
      
      if (!data || !data.data || data.data.length === 0) {
        console.error('[YahooChart] No data');
        return;
      }

      const klines = data.data.map(d => ({
        time: new Date(d.date).getTime(),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume || 0
      })).filter(k => k.close > 0);
      
      console.log('[YahooChart] Loaded', klines.length, 'candles');
      dataRef.current = klines;
      setCurrency(data.currency || 'PLN');
      
      const len = klines.length;
      setViewRange({ start: Math.max(0, len - 60), end: len });
      
      if (klines.length > 0) {
        const last = klines[klines.length - 1];
        priceRef.current = last.close;
        setOhlc({ o: last.open, h: last.high, l: last.low, c: last.close, vol: last.volume });
        setLastUpdate(new Date());
        setIsLive(true);
      }
    } catch (e) {
      console.error('[YahooChart] Load failed:', e);
    }
  }, [getYahooSymbol, getYahooPeriod, timeframe]);

  // 初始加载
  useEffect(() => {
    mountedRef.current = true;
    loadKlines();
    return () => { mountedRef.current = false; };
  }, [loadKlines]);

  // 实时价格更新
  useEffect(() => {
    const yahooSymbol = getYahooSymbol();
    if (!yahooSymbol) return;
    
    const fetchPrice = async () => {
      if (!mountedRef.current) return;
      
      try {
        const data = await yahooFinanceService.getCurrentPrice(yahooSymbol);
        
        if (data && data.price > 0 && mountedRef.current) {
          const price = data.price;
          const change = data.changePercent || 0;
          const high = data.high || price;
          const low = data.low || price;
          const volume = data.volume || 0;
          
          priceRef.current = price;
          
          setStats({
            price,
            change,
            high,
            low,
            vol: volume
          });
          
          // 更新最后一根 K 线
          const arr = dataRef.current;
          if (arr.length > 0) {
            const lastCandle = arr[arr.length - 1];
            lastCandle.close = price;
            lastCandle.high = Math.max(lastCandle.high, price);
            lastCandle.low = Math.min(lastCandle.low, price);
            setOhlc({ 
              o: lastCandle.open, 
              h: lastCandle.high, 
              l: lastCandle.low, 
              c: lastCandle.close, 
              vol: lastCandle.volume 
            });
          }
          
          setLastUpdate(new Date());
          setIsLive(true);
          
          if (onPriceUpdate) {
            onPriceUpdate({ 
              price, 
              change: data.change || 0, 
              changePct: change, 
              high, 
              low, 
              vol: volume 
            });
          }
        }
      } catch (e) {
        console.error('[YahooChart] Price error:', e);
        setIsLive(false);
      }
    };

    fetchPrice();
    // Yahoo Finance 更新频率较低，使用 30 秒间隔
    intervalRef.current = setInterval(fetchPrice, 30000);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [getYahooSymbol, onPriceUpdate]);

  // 绘图
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { frameRef.current = requestAnimationFrame(draw); return; }

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const W = rect.width, H = rect.height;
    const allData = dataRef.current;
    const price = priceRef.current;

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    if (!allData.length) {
      ctx.fillStyle = colors.text;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', W / 2, H / 2);
      frameRef.current = requestAnimationFrame(draw);
      return;
    }

    const startIdx = Math.max(0, Math.floor(viewRange.start));
    const endIdx = Math.min(allData.length, Math.ceil(viewRange.end));
    const data = allData.slice(startIdx, endIdx);
    if (!data.length) { frameRef.current = requestAnimationFrame(draw); return; }

    const margin = { t: 10, r: 70, b: 25, l: 10 };
    const chartH = (H - margin.t - margin.b) * 0.75;
    const volH = (H - margin.t - margin.b) * 0.20;
    const cW = W - margin.l - margin.r;

    let minP = Infinity, maxP = -Infinity, maxVol = 0;
    for (const c of data) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    }
    const pad = (maxP - minP) * 0.08;
    minP -= pad; maxP += pad;
    const range = maxP - minP || 1;

    const n = data.length;
    const gap = cW / n;
    const barW = Math.max(1, Math.min(gap * 0.8, 12));

    // 网格
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = margin.t + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(margin.l, y);
      ctx.lineTo(W - margin.r, y);
      ctx.stroke();
    }

    // 价格刻度
    ctx.fillStyle = colors.text;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const y = margin.t + (chartH / 4) * i;
      const p = maxP - (range / 4) * i;
      ctx.fillText(p.toFixed(2), W - margin.r + 5, y + 4);
    }

    // K 线
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      const centerX = margin.l + gap * i + gap / 2;
      const x = centerX - barW / 2;
      
      const oY = margin.t + ((maxP - c.open) / range) * chartH;
      const cY = margin.t + ((maxP - c.close) / range) * chartH;
      const hY = margin.t + ((maxP - c.high) / range) * chartH;
      const lY = margin.t + ((maxP - c.low) / range) * chartH;

      const up = c.close >= c.open;
      const color = up ? colors.up : colors.down;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX, hY);
      ctx.lineTo(centerX, lY);
      ctx.stroke();

      ctx.fillStyle = color;
      const top = Math.min(oY, cY);
      const h = Math.max(1, Math.abs(cY - oY));
      ctx.fillRect(x, top, barW, h);
    }

    // 成交量
    if (maxVol > 0) {
      const volTop = margin.t + chartH + (H - margin.t - margin.b) * 0.05;
      for (let i = 0; i < data.length; i++) {
        const c = data[i];
        const centerX = margin.l + gap * i + gap / 2;
        const x = centerX - barW / 2;
        const volBarH = (c.volume / maxVol) * volH;
        const up = c.close >= c.open;
        ctx.fillStyle = up ? colors.upLight : colors.downLight;
        ctx.fillRect(x, volTop + volH - volBarH, barW, volBarH);
      }
    }

    // 当前价格线
    if (price && price >= minP && price <= maxP) {
      const pY = margin.t + ((maxP - price) / range) * chartH;
      const lastCandle = allData[allData.length - 1];
      const up = lastCandle && price >= lastCandle.open;
      const lineColor = up ? colors.up : colors.down;

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(margin.l, pY);
      ctx.lineTo(W - margin.r, pY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = lineColor;
      ctx.fillRect(W - margin.r + 2, pY - 9, 65, 18);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(price.toFixed(2), W - margin.r + 35, pY + 4);
    }

    // 十字准线
    if (crosshair && crosshair.x >= margin.l && crosshair.x <= W - margin.r) {
      ctx.strokeStyle = '#758696';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(crosshair.x, margin.t);
      ctx.lineTo(crosshair.x, margin.t + chartH);
      ctx.stroke();
      if (crosshair.y >= margin.t && crosshair.y <= margin.t + chartH) {
        ctx.beginPath();
        ctx.moveTo(margin.l, crosshair.y);
        ctx.lineTo(W - margin.r, crosshair.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    frameRef.current = requestAnimationFrame(draw);
  }, [viewRange, crosshair, colors]);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(draw);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [draw]);

  // 交互
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1.15 : 0.87;
    const dataLen = dataRef.current.length;
    if (dataLen === 0) return;
    const currentRange = viewRange.end - viewRange.start;
    const newRange = Math.max(15, Math.min(dataLen, currentRange * delta));
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const center = viewRange.start + currentRange * ratio;
    let newStart = center - newRange * ratio;
    let newEnd = center + newRange * (1 - ratio);
    if (newStart < 0) { newStart = 0; newEnd = newRange; }
    if (newEnd > dataLen) { newEnd = dataLen; newStart = Math.max(0, dataLen - newRange); }
    setViewRange({ start: newStart, end: newEnd });
  }, [viewRange]);

  const handleMouseDown = useCallback((e) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, start: viewRange.start };
  }, [viewRange.start]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setCrosshair({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    
    if (isDragging) {
      const deltaX = e.clientX - dragStartRef.current.x;
      const cW = rect.width - 80;
      const visibleCount = viewRange.end - viewRange.start;
      const candlesDelta = -deltaX / (cW / visibleCount);
      const dataLen = dataRef.current.length;
      let newStart = dragStartRef.current.start + candlesDelta;
      let newEnd = newStart + visibleCount;
      if (newStart < 0) { newStart = 0; newEnd = visibleCount; }
      if (newEnd > dataLen) { newEnd = dataLen; newStart = Math.max(0, dataLen - visibleCount); }
      setViewRange({ start: newStart, end: newEnd });
    }
  }, [isDragging, viewRange]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);
  const handleMouseLeave = useCallback(() => { setIsDragging(false); setCrosshair(null); }, []);

  const tfs = ['1m', '30m', '1h', '1D', '1W'];
  const displaySymbol = getDisplaySymbol();
  const priceUp = ohlc.c >= ohlc.o;

  const formatPrice = (p) => p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6);

  return (
    <div className="tv-kline" style={{ height, background: colors.bg }}>
      <div className="tv-header">
        <div className="tv-symbol-section">
          <span className="tv-symbol-name">
            <span className={`tv-live-indicator ${isLive ? 'active' : ''}`}>●</span>
            {displaySymbol}
          </span>
          <span className="tv-symbol-badge">{currency}</span>
        </div>
        
        <div className="tv-live-price">
          <span className={`tv-price-value ${priceUp ? 'tv-up' : 'tv-down'}`}>
            {formatPrice(stats.price)} {currency}
          </span>
          <span className={`tv-price-change ${stats.change >= 0 ? 'tv-up' : 'tv-down'}`}>
            {stats.change >= 0 ? '+' : ''}{stats.change.toFixed(2)}%
          </span>
        </div>
        
        <div className="tv-timeframes">
          {tfs.map(tf => (
            <button key={tf} className={`tv-tf-btn ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="tv-ohlc-row">
        <span className="tv-ohlc-item"><span className="tv-ohlc-label">O</span><span className={priceUp ? 'tv-up' : 'tv-down'}>{formatPrice(ohlc.o)}</span></span>
        <span className="tv-ohlc-item"><span className="tv-ohlc-label">H</span><span className={priceUp ? 'tv-up' : 'tv-down'}>{formatPrice(ohlc.h)}</span></span>
        <span className="tv-ohlc-item"><span className="tv-ohlc-label">L</span><span className={priceUp ? 'tv-up' : 'tv-down'}>{formatPrice(ohlc.l)}</span></span>
        <span className="tv-ohlc-item"><span className="tv-ohlc-label">C</span><span className={priceUp ? 'tv-up' : 'tv-down'}>{formatPrice(ohlc.c)}</span></span>
        {lastUpdate && (
          <span className="tv-ohlc-item" style={{ marginLeft: 'auto', fontSize: '10px', color: '#787b86' }}>
            {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="tv-chart-container" style={{ height: height - 70 }}>
        <canvas 
          ref={canvasRef} 
          className="tv-canvas"
          style={{ width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'crosshair' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
      </div>
    </div>
  );
});

YahooKlineChart.displayName = 'YahooKlineChart';
export default YahooKlineChart;
