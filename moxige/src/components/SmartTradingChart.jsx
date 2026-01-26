import React, { useState, useEffect, useCallback } from 'react';
import UnifiedKlineChart from './UnifiedKlineChart';
import { useI18n } from '../i18n.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

/**
 * 智能图表组件 - 统一使用 UnifiedKlineChart
 * 所有市场（加密货币、美股、波兰股）使用相同的 UI 风格
 */
const SmartTradingChart = ({ symbol, height = 400, period = '1mo', interval = '1d', onPriceUpdate }) => {
  const { t } = useI18n();
  const [error, setError] = useState(null);

  // 根据符号前缀判断市场类型
  const getMarketType = (symbol) => {
    if (!symbol) return 'crypto';
    const s = String(symbol).toUpperCase();
    // 波兰市场：WSE (Warsaw Stock Exchange) 或 BMV 或 .WA 后缀
    if (s.includes('WSE:') || s.includes('BMV:') || s.includes('.WA')) return 'pl';
    // 美股
    if (s.includes('NASDAQ:') || s.includes('NYSE:') || s.includes('.US')) return 'us';
    // 加密货币
    if (s.includes('BINANCE:') || s.includes('COINBASE:') || s.includes('USDT')) return 'crypto';
    // 默认加密货币
    return 'crypto';
  };

  // 清理符号前缀
  const cleanSymbol = (symbol) => {
    if (!symbol) return '';
    return String(symbol)
      .replace('BINANCE:', '')
      .replace('COINBASE:', '')
      .replace('WSE:', '')
      .replace('BMV:', '')
      .replace('NASDAQ:', '')
      .replace('NYSE:', '')
      .trim();
  };

  const marketType = getMarketType(symbol);
  const cleanedSymbol = cleanSymbol(symbol);

  if (error) {
    return (
      <div className="smart-trading-chart" style={{ height: `${height}px` }}>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          backgroundColor: '#1a1a2e',
          borderRadius: '8px',
          border: '1px solid #2d2d44',
          padding: '20px'
        }}>
          <div style={{ textAlign: 'center', color: '#ef5350' }}>
            <h3>{t('chartUnavailableTitle') || 'Chart Unavailable'}</h3>
            <p>{error}</p>
            <div style={{ marginTop: '15px' }}>
              <button 
                onClick={() => { setError(null); window.location.reload(); }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#ef5350',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {t('btnRetry') || 'Retry'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="smart-trading-chart" style={{ height: `${height}px`, minHeight: `${height}px` }}>
      <ErrorBoundary>
        <UnifiedKlineChart 
          symbol={cleanedSymbol}
          market={marketType}
          height={height}
          onPriceUpdate={onPriceUpdate}
        />
      </ErrorBoundary>
    </div>
  );
};

export default SmartTradingChart;