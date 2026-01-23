import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import '../styles/native-kline.css';

/**
 * K线图组件 - 使用 OKX API（全球可用，无地区限制）
 */
const NativeKlineChart = memo(({ symbol = 'ETHUSDT', market = 'crypto', height = 400, onPriceUpdate }) => {
  const canvasRef = useRef(null);
  const dataRef = useRef([]);
  const priceRef = useRef(null);
  const frameRef = useRef(null);
  const statsRef = useRef({ price: 0, change: 0, high: 0, low: 0, vol: 0 });
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

  // 获取 OKX 交易对符号
  const getOKXInstId = useCallback(() => {
    let sym = String(symbol || '').toUpperCase();
    sym = sym.replace(/USDT$/i, '').replace(/\/USDT$/i, '').replace(/-USDT$/i, '');
    return `${sym}-USDT`;
  }, [symbol]);

  const getDisplaySymbol = useCallback(() => {
    let sym = String(symbol || '').toUpperCase();
    return sym.replace(/USDT$/i, '').replace(/\/USDT$/i, '').replace(/-USDT$/i, '');
  }, [symbol]);

  // OKX K线时间间隔映射
  const getOKXBar = useCallback((tf) => {
    const map = {
      '1m': '1m',
      '30m': '30m',
      '1h': '1H',
      '1D': '1D',
      '1W': '1W'
    };
    return map[tf] || '1H';
  }, []);

  // 加载 K 线数据（只加载一次，不在价格更新时重新加载）
  const loadKlines = useCallback(async () => {
    if (market !== 'crypto') return;
    
    const instId = getOKXInstId();
    const bar = getOKXBar(timeframe);
    console.log('[Chart] Loading klines:', instId, bar);
    
    try {
      const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=100`;
      
      const res = await fetch(url);
      if (!res.ok) {
        console.error('[Chart] Klines fetch failed:', res.status);
        return;
      }
      
      const json = await res.json();
      if (json.code !== '0' || !json.data || json.data.length === 0) {
        console.error('[Chart] Invalid klines data:', json.msg);
        return;
      }

      // OKX K线格式: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
      // 数据是倒序的（最新在前），需要反转
      const klines = json.data.reverse().map(k => ({
        time: parseInt(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
      
      console.log('[Chart] Loaded', klines.length, 'candles');
      dataRef.current = klines;
      
      const len = klines.length;
      setViewRange({ start: Math.max(0, len - 60), end: len });
      
      if (klines.length > 0) {
        const last = klines[klines.length - 1];
        priceRef.current = last.close;
        // 只设置当前K线的OHLC
        setOhlc({ o: last.open, h: last.high, l: last.low, c: last.close, vol: last.volume });
      }
    } catch (e) {
      console.error('[Chart] Load failed:', e);
    }
  }, [getOKXInstId, getOKXBar, market, timeframe]);

  // 初始加载
  useEffect(() => {
    mountedRef.current = true;
    loadKlines();
    return () => { mountedRef.current = false; };
  }, [loadKlines]);

  // 实时价格更新（使用24小时ticker数据）
  useEffect(() => {
    const instId = getOKXInstId();
    if (market !== 'crypto' || !instId) return;
    
    console.log('[Chart] Starting price updates for:', instId);
    
    const fetchPrice = async () => {
      if (!mountedRef.current) return;
      
      try {
        const url = `https://www.okx.com/api/v5/market/ticker?instId=${instId}`;
        const res = await fetch(url);
        
        if (!res.ok) {
          setIsLive(false);
          return;
        }
        
        const json = await res.json();
        if (json.code !== '0' || !json.data || !json.data[0]) {
          setIsLive(false);
          return;
        }
        
        const ticker = json.data[0];
        if (!ticker || !mountedRef.current) return;
        
        const price = parseFloat(ticker.last);
        const open24h = parseFloat(ticker.open24h);
        // 使用24小时涨跌幅，这是稳定的指标
        const change24h = open24h > 0 ? ((price - open24h) / open24h * 100) : 0;
        const high24h = parseFloat(ticker.high24h) || price;
        const low24h = parseFloat(ticker.low24h) || price;
        const volume24h = parseFloat(ticker.vol24h) || 0;
        
        priceRef.current = price;
        
        // 更新统计信息（使用24小时数据）
        const newStats = {
          price,
          change: change24h,
          high: high24h,
          low: low24h,
          vol: volume24h
        };
        statsRef.current = newStats;
        setStats(newStats);
        
        // 更新最后一根 K 线的收盘价
        const arr = dataRef.current;
        if (arr.length > 0) {
          const lastCandle = arr[arr.length - 1];
          lastCandle.close = price;
          lastCandle.high = Math.max(lastCandle.high, price);
          lastCandle.low = Math.min(lastCandle.low, price);
          // OHLC 显示当前K线数据
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
        
        // 回调父组件（使用24小时涨跌幅）
        if (onPriceUpdate) {
          onPriceUpdate({ 
            price, 
            change: price - open24h, 
            changePct: change24h, 
            high: high24h, 
            low: low24h, 
            vol: volume24h 
          });
        }
      } catch (e) {
        console.error('[Chart] Price error:', e);
        setIsLive(false);
      }
    };

    // 立即获取一次
    fetchPrice();
    
    // 每 2 秒更新一次
    intervalRef.current = setInterval(fetchPrice, 2000);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [getOKXInstId, market, onPriceUpdate]);

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

    const margin = { t: 10, r: 60, b: 25, l: 10 };
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
      ctx.fillRect(W - margin.r + 2, pY - 9, 55, 18);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(price.toFixed(2), W - margin.r + 30, pY + 4);
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
      const cW = rect.width - 70;
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
        </div>
        
        <div className="tv-live-price">
          <span className={`tv-price-value ${priceUp ? 'tv-up' : 'tv-down'}`}>
            ${formatPrice(stats.price)}
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

NativeKlineChart.displayName = 'NativeKlineChart';
export default NativeKlineChart;
