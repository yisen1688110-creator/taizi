import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';

const MarketSelector = ({ onSymbolChange, selectedSymbol = "BINANCE:ETHUSDT" }) => {
  const { t } = useI18n();
  const [selectedMarket, setSelectedMarket] = useState('crypto');
  const [selectedStock, setSelectedStock] = useState('ETH');
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const [showStockPanel, setShowStockPanel] = useState(false);
  const [hoveredMarket, setHoveredMarket] = useState(null);
  const [stockSearchTerm, setStockSearchTerm] = useState('');

  // 股票数据
  const stockData = {
    poland: [
      { symbol: 'PKO', name: 'PKO Bank Polski', price: 45.2, change: 0.3, originalSymbol: 'PKO.WA' },
      { symbol: 'PKN', name: 'PKN Orlen', price: 64.2, change: -1.7, originalSymbol: 'PKN.WA' },
      { symbol: 'PZU', name: 'PZU S.A.', price: 42.9, change: -0.4, originalSymbol: 'PZU.WA' },
      { symbol: 'CDR', name: 'CD Projekt', price: 95.7, change: 0.9, originalSymbol: 'CDR.WA' }
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

  // 默认符号映射
  

  // 市场配置
  const markets = {
    poland: {
      name: t('marketPL'),
      symbol: 'PLN 855.74',
      basePrice: 855.74,
      currency: 'PLN ',
      prefix: 'WSE:'
    },
    usa: {
      name: t('marketUS'),
      symbol: '$2,847.32',
      basePrice: 2847.32,
      currency: '$',
      prefix: 'NASDAQ:'
    },
    crypto: {
      name: t('marketCrypto'),
      symbol: '$65,000',
      basePrice: 65000,
      currency: '$',
      prefix: 'BINANCE:'
    }
  };

  // 当外部选中符号变化时，同步市场与票显示（避免仍显示 ETH 等默认值）
  useEffect(() => {
    const sym = String(selectedSymbol || "");
    if (sym.includes('BINANCE:')) {
      setSelectedMarket('crypto');
      const base = sym.replace('BINANCE:', '').replace(/(USDT|USD|BUSD)$/i, '');
      setSelectedStock(base);
    } else if (sym.includes('NASDAQ:')) {
      setSelectedMarket('usa');
      setSelectedStock(sym.replace('NASDAQ:', ''));
    } else if (sym.includes('WSE:')) {
      setSelectedMarket('poland');
      setSelectedStock(sym.replace('WSE:', ''));
    }
  }, [selectedSymbol]);

  // 根据当前市场返回搜索占位符
  const getSearchPlaceholder = () => {
    const marketKey = hoveredMarket || selectedMarket;
    if (marketKey === 'poland') return t('placeholderPL');
    if (marketKey === 'usa') return t('placeholderUS');
    if (marketKey === 'crypto') return t('placeholderCrypto');
    return t('search');
  };

  // 获取显示名称
  const getDisplayName = () => {
    if (selectedStock) {
      // 显示格式：市场名称/股票代码
      return `${markets[selectedMarket].name}/${selectedStock}`;
    }
    return markets[selectedMarket].name;
  };

  // 股票搜索和过滤功能
  const getFilteredStocks = (market) => {
    const stocks = stockData[market] || [];
    if (!stockSearchTerm) return stocks;
    
    const searchLower = stockSearchTerm.toLowerCase();
    const filtered = stocks.filter(stock => 
      stock.symbol.toLowerCase().includes(searchLower) ||
      stock.name.toLowerCase().includes(searchLower)
    );
    if (market === 'crypto') {
      const up = stockSearchTerm.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const base = up.endsWith('USDT') ? up.slice(0, -4) : up;
      if (base && !filtered.find(s => String(s.symbol).toUpperCase() === base)) {
        return [{ symbol: base, name: base, price: 0, change: 0 }, ...filtered];
      }
    }
    return filtered;
  };

  // 处理股票选择
  const handleStockSelect = (stock) => {
    // 确保设置正确的市场（使用当前悬停的市场）
    setSelectedMarket(hoveredMarket);
    
    // 对于波兰股票，使用originalSymbol来设置selectedStock，但使用TradingView符号
    if (hoveredMarket === 'poland' && stock.originalSymbol) {
      setSelectedStock(stock.originalSymbol.split('.')[0]); // 移除后缀如.MX
    } else {
      setSelectedStock(stock.symbol.split('.')[0]); // 移除后缀如.MX
    }
    
    setShowStockPanel(false);
    setShowMarketDropdown(false);
    
    // 生成TradingView符号
    let tradingViewSymbol;
    
    if (hoveredMarket === 'crypto') {
      tradingViewSymbol = `BINANCE:${stock.symbol}USDT`;
    } else if (hoveredMarket === 'usa') {
      tradingViewSymbol = `NASDAQ:${stock.symbol}`;
    } else if (hoveredMarket === 'poland') {
      // 使用TradingView兼容的符号格式
      tradingViewSymbol = `WSE:${stock.symbol}`;
    }
    
    if (onSymbolChange) {
      onSymbolChange(tradingViewSymbol);
    }
  };

  // 处理市场悬停
  const handleMarketEnter = (marketKey) => {
    setHoveredMarket(marketKey);
    setShowStockPanel(true);
  };

  

  const handlePanelEnter = () => {
    // 保持面板显示状态
    setShowStockPanel(true);
  };

  const handlePanelLeave = () => {
    setShowStockPanel(false);
    setHoveredMarket(null);
  };

  // 处理整个下拉容器的悬停
  const handleDropdownEnter = () => {
    // 当鼠标进入下拉容器时，保持当前状态
  };

  const handleDropdownLeave = () => {
    // 当鼠标离开整个下拉容器时，隐藏股票面板
    setShowStockPanel(false);
    setHoveredMarket(null);
  };

  return (
    <div className="market-selector-container">
      <div className="market-selector" onClick={() => setShowMarketDropdown(!showMarketDropdown)}>
        <h3 className="market-name">{getDisplayName()}</h3>
        <span className="dropdown-arrow">{showMarketDropdown ? '▲' : '▼'}</span>
      </div>
      
      {showMarketDropdown && (
        <div 
          className="market-dropdown-container"
          onMouseEnter={handleDropdownEnter}
          onMouseLeave={handleDropdownLeave}
        >
          <div className="market-dropdown">
            {Object.entries(markets).map(([key, market]) => (
              <div 
                key={key}
                className={`market-option ${selectedMarket === key ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedMarket(key);
                  setSelectedStock(null); // 清除之前选择的股票
                  setShowMarketDropdown(false);
                  setShowStockPanel(false);
                  
                  // 设置默认符号
                  let defaultSymbol;
                  if (key === 'crypto') {
                    defaultSymbol = 'BINANCE:ETHUSDT';
                  } else if (key === 'usa') {
                    defaultSymbol = 'NASDAQ:AAPL';
                  } else if (key === 'poland') {
                    defaultSymbol = 'WSE:PKO';
                  }
                  
                  if (onSymbolChange) {
                    onSymbolChange(defaultSymbol);
                  }
                }}
                onMouseEnter={() => handleMarketEnter(key)}
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
                  placeholder={getSearchPlaceholder()}
                  value={stockSearchTerm}
                  onChange={(e) => setStockSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && hoveredMarket === 'crypto' && stockSearchTerm) {
                      const up = stockSearchTerm.toUpperCase().replace(/[^A-Z0-9]/g, '');
                      const base = up.endsWith('USDT') ? up.slice(0, -4) : up;
                      if (base) {
                        setSelectedMarket('crypto');
                        setSelectedStock(base);
                        setShowStockPanel(false);
                        setShowMarketDropdown(false);
                        if (onSymbolChange) onSymbolChange(`BINANCE:${base}USDT`);
                      }
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="stock-list">
                {getFilteredStocks(hoveredMarket).map((stock) => (
                  <div
                    key={stock.symbol}
                    className={`stock-item ${selectedStock === stock.symbol.split('.')[0] ? 'selected' : ''}`}
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
                      <span className="price">{markets[hoveredMarket].currency}{stock.price.toFixed(2)}</span>
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
  );
};

export default MarketSelector;
