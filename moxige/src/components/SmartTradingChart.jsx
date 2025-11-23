import React, { useState, useEffect, useCallback } from 'react';
import TradingViewWidget from './TradingViewWidget';
import NativeKlineChart from './NativeKlineChart';
import YahooFinanceChart from './YahooFinanceChart';
import { useI18n } from '../i18n.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const SmartTradingChart = ({ symbol, height = 400, period = '1mo', interval = '1d' }) => {
  // 根据符号前缀判断市场类型
  const getMarketType = (symbol) => {
    if (!symbol) return 'unknown';
    if (symbol.includes('BMV:')) return 'mexico';
    if (symbol.includes('NASDAQ:') || symbol.includes('NYSE:')) return 'usa';
    if (symbol.includes('BINANCE:') || symbol.includes('COINBASE:')) return 'crypto';
    return 'unknown';
  };

  // 初始化时即根据市场类型选择数据源，避免墨股初次渲染触发 TradingView 错误
  const initialDataSource = (() => {
    const mt = getMarketType(symbol);
    return mt === 'mexico' ? 'native' : 'tradingview';
  })();

  const [dataSource, setDataSource] = useState(initialDataSource); // 'tradingview' | 'native' | 'yahoo'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const { t } = useI18n();

  const marketType = getMarketType(symbol);
  
  // 墨西哥股市默认使用 Yahoo Finance（BMV 无 WS，Yahoo 作为主数据源/回退）
  

  // 规范化 interval 以符合 TradingView 的取值
  const normalizeInterval = (ival) => {
    const v = String(ival || '').toLowerCase();
    if (v === '1d' || v === 'd') return 'D';
    if (v === '1w' || v === 'w') return 'W';
    if (v === '1m' || v === 'm') return 'M';
    if (v === '4h') return '240';
    if (v === '1h' || v === '60m' || v === '60') return '60';
    if (v === '30m' || v === '30') return '30';
    if (v === '15m' || v === '15') return '15';
    if (v === '5m' || v === '5') return '5';
    if (v === '3m' || v === '3') return '3';
    if (v === '1m' || v === '1') return '1';
    return 'D';
  };
  const tvInterval = normalizeInterval(interval);

  useEffect(() => {
    const determineDataSource = () => {
      setIsLoading(false);
      // 每次数据源重算时清理错误，避免旧的 TradingView 初始化错误影响 Yahoo 渲染
      setError(null);

      if (marketType === 'mexico') {
        // 墨西哥市场改用 TwelveData 驱动的原生图表
        setDataSource('native');
      } else {
        setDataSource('tradingview');
      }
    };

    if (symbol) {
      determineDataSource();
    }
  }, [symbol, marketType]);

  const handleTradingViewError = useCallback((err) => {
    try { console.error('TradingView error:', err); } catch {}
    // 收敛为受控回退：墨股优先使用 Yahoo；其他市场回退至原生图
    const mt = marketType;
    if (mt === 'mexico') {
      setDataSource('yahoo');
    } else {
      setDataSource('native');
    }
    // 显示友好错误文案，但不阻断整个页面（避免 ErrorBoundary 接管）
    setError(t('chartUnavailableMessage'));
  }, [t, marketType]);

  // 取消全局错误拦截，避免捕获非TradingView相关错误导致误报

  if (isLoading) {
    return (
      <div className="smart-trading-chart" style={{ height: `${height}px` }}>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          backgroundColor: '#f5f5f5',
          borderRadius: '8px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div className="spinner" style={{
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #3498db',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 10px'
            }}></div>
            <p>{t('chartInitializing')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && dataSource === 'native') {
    return (
      <div className="smart-trading-chart" style={{ height: `${height}px` }}>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          backgroundColor: '#ffebee',
          borderRadius: '8px',
          border: '1px solid #ffcdd2',
          padding: '20px'
        }}>
          <div style={{ textAlign: 'center', color: '#c62828' }}>
            <h3>{t('chartUnavailableTitle')}</h3>
            <p>{error}</p>
            <div style={{ marginTop: '15px' }}>
              <button 
                onClick={() => window.location.reload()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginRight: '10px'
                }}
              >
                {t('btnRetry')}
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
        {dataSource === 'native' ? (
          <div style={{ position: 'relative' }}>
            <NativeKlineChart 
              symbol={symbol.replace('BMV:', '')}
              market={marketType === 'mexico' ? 'mx' : 'us'}
              height={height}
            />
          </div>
        ) : dataSource === 'yahoo' ? (
          <div style={{ position: 'relative' }}>
            <YahooFinanceChart
              symbol={symbol.replace('BMV:', '')}
              height={height}
              period={period}
              interval={interval}
            />
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <TradingViewWidget 
              symbol={symbol} 
              height={height}
              interval={tvInterval}
              onError={handleTradingViewError}
            />
          </div>
        )}
      </ErrorBoundary>

      {/* CSS for animations */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default SmartTradingChart;