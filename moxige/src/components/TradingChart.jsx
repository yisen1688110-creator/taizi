import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import SmartTradingChart from './SmartTradingChart.jsx';
import '../styles/tradingview-chart.css';
const MARKETS = {
  poland: {
    name: '波兰股市',
    symbol: 'PLN 855.74',
    basePrice: 855.74,
    currency: 'PLN'
  },
  usa: {
    name: '美国股市',
    symbol: '$2,847.32',
    basePrice: 2847.32,
    currency: '$'
  },
  crypto: {
    name: '加密货币市场',
    symbol: '₿43,256.89',
    basePrice: 43256.89,
    currency: '₿'
  }
};

const TradingChart = ({ onPriceUpdate }) => {
  const chartRef = useRef(null);
  const { t } = useI18n();
  const [currentPrice, setCurrentPrice] = useState(817.20);
  const candlesRef = useRef([]);
  const [timeframe, setTimeframe] = useState('1D');
  const [selectedMarket, setSelectedMarket] = useState('poland');
  const [selectedStock, setSelectedStock] = useState('PKO.WA');
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const [showStockPanel, setShowStockPanel] = useState(false);
  const [hoveredMarket, setHoveredMarket] = useState(null);
  const [isHoveringPanel, setIsHoveringPanel] = useState(false);
  const hoverTimeoutRef = useRef(null);
  const [stockSearchTerm, setStockSearchTerm] = useState('');

  // 股票数据
  const stockData = {
    poland: [
      { symbol: 'AMXL.WA', name: 'América Móvil', price: 17.2, change: 0.8 },
      { symbol: 'WALMEX.WA', name: 'Walmart de México', price: 65.1, change: -0.3 },
      { symbol: 'BIMBOA.WA', name: 'Grupo Bimbo', price: 77.8, change: 1.2 },
      { symbol: 'FEMSAUBD.WA', name: 'FEMSA', price: 89.5, change: 0.5 },
      { symbol: 'GMEXICOB.WA', name: 'Grupo México', price: 45.3, change: -0.7 },
      { symbol: 'GFNORTEO.WA', name: 'Banorte', price: 123.4, change: 1.1 },
      { symbol: 'ALSEA.WA', name: 'Alsea', price: 34.2, change: -0.4 },
      { symbol: 'CEMEXCPO.WA', name: 'CEMEX', price: 56.7, change: 0.9 }
    ],
    usa: [
      { symbol: 'AAPL', name: 'Apple Inc.', price: 180.2, change: 0.5 },
      { symbol: 'MSFT', name: 'Microsoft Corporation', price: 410.8, change: -0.2 },
      { symbol: 'TSLA', name: 'Tesla Inc.', price: 230.3, change: 1.1 },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 142.5, change: 0.8 },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 155.7, change: -0.6 },
      { symbol: 'META', name: 'Meta Platforms Inc.', price: 485.2, change: 1.3 },
      { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 875.4, change: 2.1 },
      { symbol: 'NFLX', name: 'Netflix Inc.', price: 445.6, change: -0.9 }
    ],
    crypto: [
      { symbol: 'BTC', name: 'Bitcoin', price: 65000, change: 0.8 },
      { symbol: 'ETH', name: 'Ethereum', price: 2500, change: -0.6 },
      { symbol: 'BNB', name: 'Binance Coin', price: 320, change: 1.2 },
      { symbol: 'SOL', name: 'Solana', price: 95, change: 2.5 },
      { symbol: 'XRP', name: 'Ripple', price: 0.52, change: -1.1 },
      { symbol: 'ADA', name: 'Cardano', price: 0.38, change: 0.7 },
      { symbol: 'DOGE', name: 'Dogecoin', price: 0.08, change: 1.8 },
      { symbol: 'DOT', name: 'Polkadot', price: 6.2, change: -0.3 }
    ]
  };

  

  // 获取显示名称的函数
  const getDisplayName = () => {
    const marketName = MARKETS[selectedMarket].name;
    if (selectedStock) {
      // 如果选择了股票，显示市场名称/股票代码
      return `${marketName}/${selectedStock}`;
    } else {
      // 如果没有选择股票，显示默认的市场名称
      const defaultStocks = {
        poland: 'AMXL.WA',
        usa: 'NASDAQ',
        crypto: 'BTC'
      };
      return `${marketName}/${defaultStocks[selectedMarket]}`;
    }
  };

  // 股票搜索和过滤功能
  const getFilteredStocks = (market) => {
    const stocks = stockData[market] || [];
    if (!stockSearchTerm) return stocks;
    
    const searchLower = stockSearchTerm.toLowerCase();
    return stocks.filter(stock => 
      stock.symbol.toLowerCase().includes(searchLower) ||
      stock.name.toLowerCase().includes(searchLower)
    );
  };

  // 获取当前选择的股票数据
  const getCurrentStockData = () => {
    if (!selectedStock) return null;
    
    for (const [marketKey, stocks] of Object.entries(stockData)) {
      const stock = stocks.find(s => s.symbol === selectedStock);
      if (stock) {
        return {
          ...stock,
          market: marketKey,
          priceChangePercent: ((stock.change / stock.price) * 100)
        };
      }
    }
    return null;
  };

  const currentStockData = getCurrentStockData();
  void currentStockData;

  // 处理股票选择
  // 根据股票代码找到对应的市场
  const findMarketByStock = (stockSymbol) => {
    for (const [marketKey, stocks] of Object.entries(stockData)) {
      if (stocks.some(stock => stock.symbol === stockSymbol)) {
        return marketKey;
      }
    }
    return null;
  };

  const handleStockSelect = (stock) => {
    setSelectedStock(stock.symbol);
    setCurrentPrice(stock.price);
    
    // 根据选择的股票自动设置正确的市场
    const marketKey = findMarketByStock(stock.symbol);
    if (marketKey) {
      setSelectedMarket(marketKey);
    }
    
    setShowStockPanel(false);
    setShowMarketDropdown(false);
    
    if (onPriceUpdate) {
      onPriceUpdate(stock.price);
    }
  };

  // 处理市场悬停
  const handleMarketEnter = (marketKey) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setHoveredMarket(marketKey);
    setShowStockPanel(true);
  };

  const handleMarketLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      if (!isHoveringPanel) {
        setHoveredMarket(null);
        setShowStockPanel(false);
      }
    }, 150); // 150ms延迟
  };

  const handlePanelEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsHoveringPanel(true);
  };

  const handlePanelLeave = () => {
    setIsHoveringPanel(false);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredMarket(null);
      setShowStockPanel(false);
    }, 150); // 150ms延迟
  };

  // 生成专业的K线数据
  useEffect(() => {
    const generateCandleData = () => {
      const market = MARKETS[selectedMarket];
      const basePrice = market.basePrice;
      const candles = [];
      const now = Date.now();
      
      let currentPrice = basePrice;
      
      // 根据市场类型设置波动率
      const getVolatility = () => {
        switch(selectedMarket) {
          case 'crypto': return 50 + Math.random() * 100;
          case 'usa': return 20 + Math.random() * 40;
          case 'poland': return 10 + Math.random() * 20;
          default: return 10 + Math.random() * 20;
        }
      };
      
      // 根据市场类型设置成交量范围
      const getVolumeRange = () => {
        switch(selectedMarket) {
          case 'crypto': return { min: 50, max: 500 };
          case 'usa': return { min: 5000000, max: 20000000 };
          case 'poland': return { min: 500000, max: 2000000 };
          default: return { min: 500000, max: 2000000 };
        }
      };
      
      // 生成过去的K线数据
      for (let i = 0; i < 50; i++) {
        const time = now - (50 - i) * 15 * 60 * 1000; // 15分钟间隔
        
        // 生成开盘价
        const volatility = getVolatility();
        const open = currentPrice + (Math.random() - 0.5) * (volatility * 0.2);
        
        // 生成最高价和最低价
        const high = open + Math.random() * (volatility * 0.3);
        const low = open - Math.random() * (volatility * 0.3);
        
        // 生成收盘价
        const close = low + Math.random() * (high - low);
        
        // 生成成交量
        const volumeRange = getVolumeRange();
        const volume = Math.floor(Math.random() * (volumeRange.max - volumeRange.min)) + volumeRange.min;
        
        const minPrice = selectedMarket === 'crypto' ? 0 : selectedMarket === 'usa' ? 1000 : 800;
        
        const candle = {
          time,
          open: Math.max(open, minPrice),
          high: Math.max(high, minPrice),
          low: Math.max(low, minPrice),
          close: Math.max(close, minPrice),
          volume
        };
        
        candles.push(candle);
        
        currentPrice = candle.close;
      }
      
      candlesRef.current = candles;
      setCurrentPrice(currentPrice);
    };

    generateCandleData();

    // 模拟实时更新
    const priceInterval = setInterval(() => {
      const prevCandles = candlesRef.current || [];
      if (!prevCandles.length) return;
      const lastCandle = prevCandles[prevCandles.length - 1];
      const newCandles = [...prevCandles];
        
        // 更新最后一根K线或创建新的K线
        const now = Date.now();
        const timeDiff = now - lastCandle.time;
        
        if (timeDiff > 15 * 60 * 1000) { // 15分钟后创建新K线
          const open = lastCandle.close;
          const volatility = 2 + Math.random() * 3;
          const high = open + Math.random() * volatility;
          const low = open - Math.random() * volatility;
          const close = low + Math.random() * (high - low);
          
          const newCandle = {
            time: now,
            open,
            high: Math.max(high, 800),
            low: Math.max(low, 800),
            close: Math.max(close, 800),
            volume: Math.floor(Math.random() * 2000000) + 500000
          };
          
          newCandles.push(newCandle);
          setCurrentPrice(newCandle.close);
          
          if (onPriceUpdate) {
            onPriceUpdate(newCandle.close);
          }
          
          // 保持最近50根K线
          if (newCandles.length > 50) {
            newCandles.shift();
          }
        } else {
          // 更新当前K线
          const updatedCandle = { ...lastCandle };
          const priceChange = (Math.random() - 0.5) * 1;
          updatedCandle.close = Math.max(updatedCandle.close + priceChange, 800);
          updatedCandle.high = Math.max(updatedCandle.high, updatedCandle.close);
          updatedCandle.low = Math.min(updatedCandle.low, updatedCandle.close);
          
          newCandles[newCandles.length - 1] = updatedCandle;
          setCurrentPrice(updatedCandle.close);
          
          if (onPriceUpdate) {
            onPriceUpdate(updatedCandle.close);
          }
        }
        
        candlesRef.current = newCandles;
    }, 2000); // 每2秒更新

    return () => clearInterval(priceInterval);
  }, [onPriceUpdate, selectedMarket]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (chartRef.current && !chartRef.current.contains(event.target)) {
        setShowMarketDropdown(false);
        setShowStockPanel(false);
      }
    };

    if (showMarketDropdown || showStockPanel) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMarketDropdown, showStockPanel]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="trading-chart-widget professional" ref={chartRef}>
      <div className="chart-header">
        <div className="symbol-info">
          <div className="market-selector-container">
            <div className="market-selector" onClick={() => setShowMarketDropdown(!showMarketDropdown)}>
              <h3 className="market-name">{getDisplayName()}</h3>
              <span className="dropdown-arrow">{showMarketDropdown ? '▲' : '▼'}</span>
            </div>
            
            {showMarketDropdown && (
              <div className="market-dropdown-container">
                <div className="market-dropdown">
                  {Object.entries(MARKETS).map(([key, market]) => (
                    <div 
                      key={key}
                      className={`market-option ${selectedMarket === key ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMarket(key);
                        setCurrentPrice(market.basePrice);
                        setSelectedStock(null); // 清除之前选择的股票
                        setShowMarketDropdown(false);
                        setShowStockPanel(false);
                      }}
                      onMouseEnter={() => handleMarketEnter(key)}
                      onMouseLeave={handleMarketLeave}
                    >
                      {market.name}
                    </div>
                  ))}
                </div>
                
                {showStockPanel && hoveredMarket && (
                  <div 
                    className="stock-panel"
                    onMouseEnter={handlePanelEnter}
                    onMouseLeave={handlePanelLeave}
                  >
                    <div className="stock-panel-header">
                      <input
                        type="text"
                        className="stock-search"
                        placeholder={t('search')}
                        value={stockSearchTerm}
                        onChange={(e) => setStockSearchTerm(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="stock-list">
                      {getFilteredStocks(hoveredMarket).map((stock) => (
                        <div
                          key={stock.symbol}
                          className={`stock-item ${selectedStock === stock.symbol ? 'selected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStockSelect(stock);
                          }}
                        >
                          <div className="stock-info">
                            <span className="stock-symbol">{stock.symbol}</span>
                            <span className="stock-name">{stock.name}</span>
                          </div>
                          <div className="stock-price">
                            <span className="price">{MARKETS[hoveredMarket].currency}{stock.price.toFixed(2)}</span>
                            <span className={`change ${stock.change >= 0 ? 'positive' : 'negative'}`}>
                              {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="price-display">
            <span className="current-price">{MARKETS[selectedMarket].currency}{currentPrice.toFixed(2)}</span>
            <span className="price-change positive">
              +{(currentPrice - MARKETS[selectedMarket].basePrice).toFixed(2)} (+{((currentPrice - MARKETS[selectedMarket].basePrice) / MARKETS[selectedMarket].basePrice * 100).toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="chart-controls">
          {['1D', '1W', '1M', '3M', '1Y'].map(period => (
            <button 
              key={period}
              className={`time-btn ${timeframe === period ? 'active' : ''}`}
              onClick={() => setTimeframe(period)}
            >
              {period}
            </button>
          ))}
        </div>
      </div>
      
      <div className="chart-container professional">
        {(() => {
          const stock = selectedStock || 'AMXL.WA';
          const buildSymbol = () => {
            if (selectedMarket === 'poland') return `BMV:${stock}`;
            if (selectedMarket === 'usa') return `NASDAQ:${stock}`;
            const base = String(stock).toUpperCase().replace(/USDT$/,'');
            return `BINANCE:${base}USDT`;
          };
          const mapInterval = (tf) => {
            const v = String(tf || '').toUpperCase();
            if (v === '1D') return 'D';
            if (v === '1W') return 'W';
            if (v === '1M' || v === '3M' || v === '1Y') return 'M';
            return 'D';
          };
          return (
            <SmartTradingChart
              symbol={buildSymbol()}
              height={400}
              interval={mapInterval(timeframe)}
            />
          );
        })()}
      </div>
    </div>
  );
};

export default TradingChart;