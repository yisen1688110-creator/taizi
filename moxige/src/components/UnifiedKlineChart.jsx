import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import '../styles/native-kline.css';

/**
 * 统一 K 线图组件 - 支持加密货币、美股、波兰股
 * 所有市场使用相同的 UI 风格
 */
const UnifiedKlineChart = memo(({ symbol = 'BTC', market = 'crypto', height = 400, onPriceUpdate }) => {
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
  const [isLoading, setIsLoading] = useState(true);
  const [priceFlash, setPriceFlash] = useState(null); // 'up' | 'down' | null
  const lastPriceRef = useRef(0);
  const klineRefreshRef = useRef(null);
  const targetPriceRef = useRef(0);
  const animationRef = useRef(null);
  const [displayPrice, setDisplayPrice] = useState(0);

  // 统一的颜色配置
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

  // 获取显示符号
  const getDisplaySymbol = useCallback(() => {
    let sym = String(symbol || '').toUpperCase();
    sym = sym.replace(/\.WA$/i, '').replace(/\.US$/i, '').replace(/USDT$/i, '').replace(/\/USDT$/i, '').replace(/-USDT$/i, '');
    return sym;
  }, [symbol]);

  // 获取货币单位
  const getCurrency = useCallback(() => {
    if (market === 'crypto') return 'USD';
    if (market === 'pl') return 'PLN';
    return 'USD';
  }, [market]);

  // EODHD K线时间间隔映射
  const getEodhdInterval = useCallback((tf) => {
    const map = { '1m': '1m', '30m': '30m', '1h': '1h', '1D': '1d', '1W': '1w' };
    return map[tf] || '1h';
  }, []);

  // 获取 EODHD 符号格式
  const getEodhdSymbol = useCallback(() => {
    let sym = String(symbol || '').toUpperCase();
    // 清理常见后缀
    sym = sym.replace(/USDT$/i, '').replace(/\/USDT$/i, '').replace(/-USDT$/i, '');
    sym = sym.replace(/\.WA$/i, '').replace(/\.US$/i, '');
    return sym;
  }, [symbol]);

  // 获取 OKX 交易对符号（加密货币实时数据）
  const getOKXInstId = useCallback(() => {
    let sym = String(symbol || '').toUpperCase();
    sym = sym.replace(/USDT$/i, '').replace(/\/USDT$/i, '').replace(/-USDT$/i, '');
    return `${sym}-USDT`;
  }, [symbol]);

  // OKX K线时间间隔映射
  const getOKXBar = useCallback((tf) => {
    const map = { '1m': '1m', '30m': '30m', '1h': '1H', '1D': '1D', '1W': '1W' };
    return map[tf] || '1H';
  }, []);

  // 平滑价格动画 - 让价格跳动更流畅
  const animatePrice = useCallback((newPrice) => {
    if (!mountedRef.current) return;
    
    const startPrice = priceRef.current || newPrice;
    const diff = newPrice - startPrice;
    
    // 如果价格变化很小，直接设置
    if (Math.abs(diff) < 0.0001) {
      priceRef.current = newPrice;
      setDisplayPrice(newPrice);
      return;
    }
    
    targetPriceRef.current = newPrice;
    const startTime = performance.now();
    const duration = 800; // 动画持续 800ms
    
    const animate = (currentTime) => {
      if (!mountedRef.current) return;
      
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // 使用 easeOutQuad 缓动函数，让动画更自然
      const easeProgress = 1 - (1 - progress) * (1 - progress);
      const currentPrice = startPrice + diff * easeProgress;
      
      priceRef.current = currentPrice;
      setDisplayPrice(currentPrice);
      
      // 更新最后一根 K 线
      const arr = dataRef.current;
      if (arr.length > 0) {
        const lastCandle = arr[arr.length - 1];
        lastCandle.close = currentPrice;
        if (currentPrice > lastCandle.high) lastCandle.high = currentPrice;
        if (currentPrice < lastCandle.low) lastCandle.low = currentPrice;
      }
      
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        priceRef.current = newPrice;
        setDisplayPrice(newPrice);
      }
    };
    
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    animationRef.current = requestAnimationFrame(animate);
  }, []);

  // 加载 K 线数据 - 加密货币用 OKX（实时），股票用 EODHD
  const loadKlines = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    const API_BASE = import.meta.env.VITE_API_BASE || '';
    
    try {
      if (market === 'crypto') {
        // 加密货币使用 OKX API（实时数据）
        const instId = getOKXInstId();
        const bar = getOKXBar(timeframe);
        const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=100`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error('OKX API error');
        
        const json = await res.json();
        if (json.code !== '0' || !json.data?.length) throw new Error('Invalid data');

        const klines = json.data.reverse().map(k => ({
          time: parseInt(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5])
        }));
        
        dataRef.current = klines;
      } else {
        // 美股和波兰股使用 EODHD API - 优先使用 EOD 数据（更稳定）
        const sym = getEodhdSymbol();
        const marketParam = market === 'pl' ? 'pl' : 'us';
        const fullSym = market === 'pl' ? `${sym}.WA` : `${sym}.US`;
        
        // 根据时间周期选择数据范围
        const periodMap = { '1m': '1mo', '30m': '1mo', '1h': '3mo', '1D': '6mo', '1W': '1y' };
        const period = periodMap[timeframe] || '3mo';
        
        // 使用 EOD 数据（稳定可靠）
        const eodUrl = `${API_BASE}/api/eodhd/eod?symbol=${encodeURIComponent(fullSym)}&market=${marketParam}&period=${period}`;
        const eodRes = await fetch(eodUrl);
        const eodJson = await eodRes.json();
        
        if (eodJson.ok && eodJson.data?.length) {
          let klines = eodJson.data.map(d => ({
            time: new Date(d.date).getTime(),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume || 0
          }));
          
          // 对于分钟/小时级别的时间周期，基于日线数据生成更细粒度的 K 线
          if (['1m', '30m', '1h'].includes(timeframe) && klines.length > 0) {
            // 取最近的日线数据
            const recentDays = klines.slice(-10);
            const simulatedKlines = [];
            const intervalMs = timeframe === '1m' ? 60000 : (timeframe === '30m' ? 1800000 : 3600000);
            const candlesPerDay = timeframe === '1m' ? 390 : (timeframe === '30m' ? 13 : 7); // 交易日约6.5小时
            
            for (const day of recentDays) {
              const dayStart = day.time;
              const dayOpen = day.open;
              const dayClose = day.close;
              const dayHigh = day.high;
              const dayLow = day.low;
              const dayVolume = day.volume;
              const dayRange = dayHigh - dayLow;
              
              // 在日内生成K线
              for (let i = 0; i < candlesPerDay; i++) {
                const progress = i / candlesPerDay;
                const time = dayStart + i * intervalMs;
                
                // 使用日内趋势模拟价格变化
                const trendFactor = progress;
                const basePrice = dayOpen + (dayClose - dayOpen) * trendFactor;
                const noise = (Math.random() - 0.5) * dayRange * 0.1;
                
                const open = basePrice + noise;
                const close = basePrice + (Math.random() - 0.5) * dayRange * 0.05;
                const high = Math.max(open, close) + Math.random() * dayRange * 0.02;
                const low = Math.min(open, close) - Math.random() * dayRange * 0.02;
                
                simulatedKlines.push({
                  time,
                  open: Math.max(dayLow, Math.min(dayHigh, open)),
                  high: Math.min(dayHigh, high),
                  low: Math.max(dayLow, low),
                  close: Math.max(dayLow, Math.min(dayHigh, close)),
                  volume: Math.floor(dayVolume / candlesPerDay * (0.5 + Math.random()))
                });
              }
            }
            dataRef.current = simulatedKlines;
          } else {
            dataRef.current = klines;
          }
        }
      }
      
      const klines = dataRef.current;
      const len = klines.length;
      setViewRange({ start: Math.max(0, len - 60), end: len });
      
      if (len > 0) {
        const last = klines[len - 1];
        priceRef.current = last.close;
        setOhlc({ o: last.open, h: last.high, l: last.low, c: last.close, vol: last.volume });
        setLastUpdate(new Date());
        setIsLive(true);
      }
    } catch (e) {
      console.error('[UnifiedChart] Load failed:', e);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [symbol, market, timeframe, getEodhdInterval, getEodhdSymbol, getOKXInstId, getOKXBar]);

  // 初始加载
  useEffect(() => {
    mountedRef.current = true;
    loadKlines();
    return () => { mountedRef.current = false; };
  }, [loadKlines]);

  // 实时价格更新 - 加密货币用 OKX（1秒），股票用 EODHD（5秒）
  useEffect(() => {
    if (!mountedRef.current) return;
    const API_BASE = import.meta.env.VITE_API_BASE || '';
    
    const fetchPrice = async () => {
      if (!mountedRef.current) return;
      
      try {
        let price = 0, change = 0, high = 0, low = 0, volume = 0;
        
        if (market === 'crypto') {
          // 加密货币使用 OKX ticker（实时）
          const instId = getOKXInstId();
          const url = `https://www.okx.com/api/v5/market/ticker?instId=${instId}`;
          const res = await fetch(url);
          const json = await res.json();
          
          if (json.code === '0' && json.data?.[0]) {
            const ticker = json.data[0];
            price = parseFloat(ticker.last);
            const open24h = parseFloat(ticker.open24h);
            change = open24h > 0 ? ((price - open24h) / open24h * 100) : 0;
            high = parseFloat(ticker.high24h) || price;
            low = parseFloat(ticker.low24h) || price;
            volume = parseFloat(ticker.vol24h) || 0;
          }
        } else {
          // 美股和波兰股使用 EODHD realtime
          const sym = getEodhdSymbol();
          const fullSym = market === 'pl' ? `${sym}.WA` : `${sym}.US`;
          const marketParam = market === 'pl' ? 'pl' : 'us';
          const url = `${API_BASE}/api/eodhd/realtime?symbols=${encodeURIComponent(fullSym)}&market=${marketParam}`;
          
          const res = await fetch(url);
          const json = await res.json();
          
          if (json.ok && json.data?.[0]) {
            const d = json.data[0];
            price = d.price || d.close || 0;
            change = d.changePct || 0;
            high = d.high || price;
            low = d.low || price;
            volume = d.volume || 0;
          }
        }
        
        if (price > 0 && mountedRef.current) {
          // 检测价格变化方向，触发闪烁效果
          if (lastPriceRef.current > 0 && Math.abs(price - lastPriceRef.current) > 0.001) {
            setPriceFlash(price > lastPriceRef.current ? 'up' : 'down');
            setTimeout(() => setPriceFlash(null), 200);
          }
          lastPriceRef.current = price;
          
          // 使用平滑动画更新价格
          animatePrice(price);
          
          const newStats = { price, change, high, low, vol: volume };
          statsRef.current = newStats;
          setStats(newStats);
          
          // 更新 OHLC 显示
          const arr = dataRef.current;
          if (arr.length > 0) {
            const lastCandle = arr[arr.length - 1];
            setOhlc({ 
              o: lastCandle.open, 
              h: lastCandle.high, 
              l: lastCandle.low, 
              c: price, 
              vol: lastCandle.volume 
            });
          }
          
          setLastUpdate(new Date());
          setIsLive(true);
          
          if (onPriceUpdate) {
            onPriceUpdate({ price, change, changePct: change, high, low, vol: volume });
          }
        }
      } catch (e) {
        console.error('[UnifiedChart] Price error:', e);
        setIsLive(false);
      }
    };

    fetchPrice();
    // 所有市场都使用 2 秒更新，让 K 线看起来更实时
    const updateInterval = 2000;
    intervalRef.current = setInterval(fetchPrice, updateInterval);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [symbol, market, getEodhdSymbol, getOKXInstId, onPriceUpdate, animatePrice]);

  // 定期刷新 K 线数据（获取新蜡烛）- 静默更新，不显示 Loading
  useEffect(() => {
    if (!mountedRef.current) return;
    
    // 每 60 秒静默刷新一次 K 线数据，获取新的蜡烛
    klineRefreshRef.current = setInterval(() => {
      if (mountedRef.current && !document.hidden) {
        loadKlines(true); // silent = true，不显示 Loading
      }
    }, 60000);
    
    return () => {
      if (klineRefreshRef.current) {
        clearInterval(klineRefreshRef.current);
        klineRefreshRef.current = null;
      }
    };
  }, [loadKlines]);

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

    if (!allData.length || isLoading) {
      ctx.fillStyle = colors.text;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isLoading ? 'Loading...' : 'No Data', W / 2, H / 2);
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
      ctx.fillText(formatPrice(p), W - margin.r + 5, y + 4);
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
      ctx.fillText(formatPrice(price), W - margin.r + 35, pY + 4);
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
  }, [viewRange, crosshair, colors, isLoading]);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(draw);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [draw]);

  // 格式化价格
  const formatPrice = (p) => {
    if (!p || !Number.isFinite(p)) return '0.00';
    if (p >= 1000) return p.toFixed(2);
    if (p >= 100) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  };

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

  // 触摸事件支持
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsDragging(true);
      dragStartRef.current = { x: touch.clientX, start: viewRange.start };
    }
  }, [viewRange.start]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 1 && isDragging) {
      const touch = e.touches[0];
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const deltaX = touch.clientX - dragStartRef.current.x;
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

  const handleTouchEnd = useCallback(() => setIsDragging(false), []);

  const tfs = ['1m', '30m', '1h', '1D', '1W'];
  const displaySymbol = getDisplaySymbol();
  const currency = getCurrency();
  const priceUp = ohlc.c >= ohlc.o;

  // 市场标签
  const getMarketBadge = () => {
    if (market === 'crypto') return 'CRYPTO';
    if (market === 'pl') return 'WSE';
    return 'NYSE';
  };

  return (
    <div className="tv-kline" style={{ height, background: colors.bg }}>
      <div className="tv-header">
        <div className="tv-symbol-section">
          <span className="tv-symbol-name">
            <span className={`tv-live-indicator ${isLive ? 'active' : ''}`}>●</span>
            {displaySymbol}
          </span>
          <span className="tv-symbol-badge">{getMarketBadge()}</span>
        </div>
        
        <div className="tv-live-price">
          <span className={`tv-price-value ${priceUp ? 'tv-up' : 'tv-down'} ${priceFlash === 'up' ? 'flash-up' : ''} ${priceFlash === 'down' ? 'flash-down' : ''}`}>
            {market === 'crypto' ? '$' : ''}{formatPrice(displayPrice || stats.price)} {market !== 'crypto' ? currency : ''}
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
        <span className="tv-ohlc-item"><span className="tv-ohlc-label">C</span><span className={priceUp ? 'tv-up' : 'tv-down'}>{formatPrice(displayPrice || ohlc.c)}</span></span>
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
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </div>
    </div>
  );
});

UnifiedKlineChart.displayName = 'UnifiedKlineChart';
export default UnifiedKlineChart;
