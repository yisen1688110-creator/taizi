import React, { useEffect, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
import 'chartjs-adapter-date-fns';
import yahooFinanceService from '../services/yahooFinanceService';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  CandlestickController,
  CandlestickElement,
  Tooltip,
  Legend
);

const YahooFinanceChart = ({ symbol, period = '1mo', interval = '1d', height = 400 }) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockData, setStockData] = useState(null);

  useEffect(() => {
    if (!symbol) return;

    const loadChartData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Convert symbol to Yahoo Finance format
        const yahooSymbol = yahooFinanceService.convertToYahooSymbol(symbol);

        // Fetch historical data (includes meta with latest price)
        const historicalData = await yahooFinanceService.getHistoricalData(yahooSymbol, period, interval);

        // Derive current price from historical meta when available to reduce requests
        let currentPrice = null;
        try {
          const last = historicalData?.data?.[historicalData.data.length - 1];
          const price = Number(last?.close);
          if (Number.isFinite(price)) {
            currentPrice = {
              symbol: yahooSymbol,
              price,
              change: 0,
              changePercent: 0,
              volume: last?.volume ?? null,
              currency: historicalData?.currency,
              exchangeName: historicalData?.exchangeName,
              timestamp: last?.date ?? new Date(),
              previousClose: price,
            };
          }
        } catch {}

        if (!currentPrice) {
          currentPrice = await yahooFinanceService.getCurrentPrice(yahooSymbol);
        }

        // Set data; chart will be initialized in a separate effect once canvas is ready
        setStockData({ historical: historicalData, current: currentPrice });
        setLoading(false);
      } catch (err) {
        console.error('Error loading chart data:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    loadChartData();

    // Cleanup function: destroy chart when unmounting or before re-init
    return () => {
      if (chartInstance.current) {
        try { chartInstance.current.destroy(); } catch {}
        chartInstance.current = null;
      }
    };
  }, [symbol, period, interval]);

  // Initialize chart only after data is loaded and canvas exists
  useEffect(() => {
    if (!stockData?.historical) return;
    const canvas = chartRef.current;
    if (!canvas) return; // canvas not yet mounted
    const ctx = canvas.getContext('2d');
    if (!ctx) { setError('Chart context unavailable'); return; }

    // Prepare chart data
    const chartData = (stockData.historical?.data || []).map(item => ({
      x: item.date,
      o: item.open,
      h: item.high,
      l: item.low,
      c: item.close
    }));

    // Destroy existing chart before creating a new one
    if (chartInstance.current) {
      try { chartInstance.current.destroy(); } catch {}
      chartInstance.current = null;
    }

    try {
      chartInstance.current = new ChartJS(ctx, {
        type: 'candlestick',
        data: {
          datasets: [{
            label: `${symbol} (${stockData.historical.currency})`,
            data: chartData,
            borderColor: {
              up: '#26a69a',
              down: '#ef5350',
              unchanged: '#999999'
            },
            backgroundColor: {
              up: 'rgba(38, 166, 154, 0.8)',
              down: 'rgba(239, 83, 80, 0.8)',
              unchanged: 'rgba(153, 153, 153, 0.8)'
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: interval === '1d' ? 'day' : 'hour',
                displayFormats: {
                  day: 'MMM dd',
                  hour: 'HH:mm'
                }
              },
              title: {
                display: true,
                text: 'Date'
              }
            },
            y: {
              title: {
                display: true,
                text: `Price (${stockData.historical.currency})`
              },
              position: 'right'
            }
          },
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                title: function(context) {
                  return new Date(context[0].parsed.x).toLocaleDateString();
                },
                label: function(context) {
                  const data = context.parsed;
                  return [
                    `Open: ${data.o?.toFixed(2)}`,
                    `High: ${data.h?.toFixed(2)}`,
                    `Low: ${data.l?.toFixed(2)}`,
                    `Close: ${data.c?.toFixed(2)}`
                  ];
                }
              }
            },
            legend: {
              display: true,
              position: 'top'
            }
          },
          interaction: {
            intersect: false,
            mode: 'index'
          }
        }
      });
    } catch (err) {
      console.error('Error initializing chart:', err);
      setError(err.message || String(err));
    }
  }, [stockData, interval, symbol]);

  const formatPrice = (price) => {
    return price?.toFixed(2) || 'N/A';
  };

  const formatChange = (change, changePercent) => {
    if (!change || !changePercent) return 'N/A';
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)`;
  };

  

  // Always render canvas; show loading/error as overlay to avoid null ref

  return (
    <div className="yahoo-chart card trading-chart-container" style={{ height: `${height}px` }}>
      {/* Stock Info Header */}
      {stockData?.current && (
        <div className="chart-header">
          <div className="symbol-info">
            <h3 className="symbol-name">{stockData.current.symbol}</h3>
            <p className="stock-name">{stockData.current.exchangeName}</p>
          </div>
          <div className="price-display">
            <div className="current-price">
              {formatPrice(stockData.current.price)} {stockData.current.currency}
            </div>
            <div className={`price-change ${stockData.current.change >= 0 ? 'positive' : 'negative'}`}>
              {formatChange(stockData.current.change, stockData.current.changePercent)}
            </div>
          </div>
        </div>
      )}

      {/* Chart Canvas */}
      <div className="chart-container professional" style={{ height: stockData?.current ? `${height - 100}px` : `${height}px` }}>
        <canvas ref={chartRef} className="candlestick-chart"></canvas>
        {loading && (
          <div className="chart-loading" style={{ position: 'absolute', inset: 0 }}>
            <div className="loading-spinner" />
            <p>Loading {symbol} data...</p>
          </div>
        )}
        {error && (
          <div className="chart-error-overlay" style={{ position: 'absolute', inset: 0 }}>
            <div className="chart-error-content">
              <h3>Error Loading Data</h3>
              <p>{error}</p>
              <button className="close-btn" onClick={() => window.location.reload()}>Retry</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default YahooFinanceChart;