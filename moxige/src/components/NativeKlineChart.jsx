import React, { useRef, useEffect, useState, useCallback } from 'react';
import '../styles/native-kline.css';
import { getStockSpark } from '../services/marketData.js';
import { useI18n } from '../i18n';

const NativeKlineChart = ({ symbol = 'ETHUSDT', market = 'us', height = 400 }) => {
  const { t } = useI18n();
  const canvasRef = useRef(null);
  const [timeframe, setTimeframe] = useState('1D');
  const [chartType, setChartType] = useState('candlestick');
  const [klineData, setKlineData] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    const apiKey = '45a943df091e40af9f9444d58bd520a0';
    wsRef.current = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${apiKey}`);

    wsRef.current.onopen = () => {
      const tdSymbol = String(symbol || '').replace(/^BMV:/i, '').replace(/\.MX$/i, '').replace(/\//g, '');
      wsRef.current.send(JSON.stringify({
        action: 'subscribe',
        params: { symbols: tdSymbol },
      }));
    };

    // 初始加载历史K线（REST），避免 WS 尚未推送时为空
    (async () => {
      try {
        const closes = await getStockSpark(String(symbol).replace(/^BMV:/i, '').replace(/\.MX$/i, ''), market, { interval: '5min', points: 60 });
        if (Array.isArray(closes) && closes.length) {
          const now = Date.now();
          const seeded = closes.slice(-60).map((c, i) => ({
            timestamp: now - (closes.length - i) * 300000,
            open: c,
            high: c,
            low: c,
            close: c,
            volume: 0,
          }));
          setKlineData(seeded);
        }
      } catch {}
    })();

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.event === 'price') {
        setKlineData((prevData) => {
          const newData = [...prevData];
          const now = Date.now();
          if (newData.length > 0) {
            const lastCandle = newData[newData.length - 1];
            // 更新当前蜡烛或创建新蜡烛（简化：每条消息更新为新蜡烛）
            newData[newData.length - 1] = {
              ...lastCandle,
              close: data.price,
              high: Math.max(lastCandle.high, data.price),
              low: Math.min(lastCandle.low, data.price),
            };
          } else {
            // 初始化第一个蜡烛
            newData.push({
              timestamp: now,
              open: data.price,
              high: data.price,
              low: data.price,
              close: data.price,
              volume: 0,
            });
          }
          if (newData.length > 100) newData.shift();
          return newData;
        });
      }
    };

    wsRef.current.onclose = () => {
      console.log('WebSocket closed');
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [symbol]);

  // 移除 generateMockData 函数，使用 WebSocket 数据

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    
    // 清空画布
    ctx.fillStyle = '#0B1426';
    ctx.fillRect(0, 0, width, height);

    if (!klineData || klineData.length === 0) return;

    // 计算价格范围
    const prices = klineData.flatMap(d => [d.high, d.low]);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const priceRange = maxPrice - minPrice;
    
    // 图表区域设置
    const padding = { top: 20, right: 80, bottom: 60, left: 20 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // 绘制网格线
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    
    // 水平网格线
    for (let i = 0; i <= 10; i++) {
      const y = padding.top + (chartHeight / 10) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }
    
    // 垂直网格线
    for (let i = 0; i <= 10; i++) {
      const x = padding.left + (chartWidth / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
    }

    // 绘制价格标签
    ctx.fillStyle = '#94A3B8';
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    
    for (let i = 0; i <= 5; i++) {
      const price = maxPrice - (priceRange / 5) * i;
      const y = padding.top + (chartHeight / 5) * i;
      ctx.fillText(price.toFixed(2), width - padding.right + 5, y + 4);
    }

    // 绘制K线
    const candleWidth = Math.max(2, chartWidth / klineData.length * 0.8);
    
    klineData.forEach((candle, index) => {
      const x = padding.left + (chartWidth / klineData.length) * index + (chartWidth / klineData.length - candleWidth) / 2;
      
      // 计算价格对应的Y坐标
      const openY = padding.top + ((maxPrice - candle.open) / priceRange) * chartHeight;
      const closeY = padding.top + ((maxPrice - candle.close) / priceRange) * chartHeight;
      const highY = padding.top + ((maxPrice - candle.high) / priceRange) * chartHeight;
      const lowY = padding.top + ((maxPrice - candle.low) / priceRange) * chartHeight;
      
      // 确定颜色（涨绿跌红）
      const isUp = candle.close > candle.open;
      const color = isUp ? '#00C851' : '#FF4444';
      
      // 绘制影线
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, highY);
      ctx.lineTo(x + candleWidth / 2, lowY);
      ctx.stroke();
      
      // 绘制实体
      ctx.fillStyle = color;
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.abs(closeY - openY);
      
      if (bodyHeight < 1) {
        // 十字星
        ctx.fillRect(x, bodyTop, candleWidth, 1);
      } else {
        ctx.fillRect(x, bodyTop, candleWidth, bodyHeight);
      }
    });

    // 绘制当前价格线
    if (klineData.length > 0) {
      const currentPrice = klineData[klineData.length - 1].close;
      const currentY = padding.top + ((maxPrice - currentPrice) / priceRange) * chartHeight;
      
      ctx.strokeStyle = '#FFA500';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padding.left, currentY);
      ctx.lineTo(width - padding.right, currentY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 价格标签
      ctx.fillStyle = '#FFA500';
      ctx.fillRect(width - padding.right, currentY - 10, 70, 20);
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.fillText(currentPrice.toFixed(2), width - padding.right + 35, currentY + 4);
    }
  }, [klineData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 设置高DPI支持
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    
    drawChart();
  }, [drawChart]);

  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1D', '1W', '1M'];

  return (
    <div className="native-kline-chart" style={{ height: `${height}px` }}>
      {/* TradingView风格的工具栏 */}
      <div className="chart-toolbar">
        <div className="toolbar-left">
          <div className="symbol-info">
            <span className="symbol">{symbol}</span>
          </div>
          
          <div className="timeframe-selector">
            {timeframes.map(tf => (
              <button
                key={tf}
                className={`timeframe-btn ${timeframe === tf ? 'active' : ''}`}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        
        <div className="toolbar-right">
          <div className="chart-type-selector">
            <button
              className={`chart-type-btn ${chartType === 'candlestick' ? 'active' : ''}`}
              onClick={() => setChartType('candlestick')}
              title={t('klineCandlestick')}
            >
              📊
            </button>
            <button
              className={`chart-type-btn ${chartType === 'line' ? 'active' : ''}`}
              onClick={() => setChartType('line')}
              title={t('klineLine')}
            >
              📈
            </button>
          </div>
          
          <div className="chart-tools">
            <button className="tool-btn" title={t('klineFullscreen')}>⛶</button>
            <button className="tool-btn" title={t('klineSettings')}>⚙️</button>
          </div>
        </div>
      </div>

      {/* 价格信息面板 */}
      <div className="price-info-panel">
        {klineData.length > 0 && (
          <>
            <span className="price-label">{t('klineOpen')}</span>
            <span className="price-value">{klineData[klineData.length - 1].open.toFixed(2)}</span>
            <span className="price-label">{t('klineHigh')}</span>
            <span className="price-value">{klineData[klineData.length - 1].high.toFixed(2)}</span>
            <span className="price-label">{t('klineLow')}</span>
            <span className="price-value">{klineData[klineData.length - 1].low.toFixed(2)}</span>
            <span className="price-label">{t('klineClose')}</span>
            <span className="price-value">{klineData[klineData.length - 1].close.toFixed(2)}</span>
            <span className="price-label">{t('klineVolume')}</span>
            <span className="price-value">{(klineData[klineData.length - 1].volume / 1000).toFixed(1)}K</span>
          </>
        )}
      </div>

      {/* K线图画布 */}
      <canvas
        ref={canvasRef}
        className="kline-canvas"
        style={{
          width: '100%',
          height: `${height - 80}px`,
          display: 'block'
        }}
      />
    </div>
  );
};

export default NativeKlineChart;