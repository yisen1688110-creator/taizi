import { useEffect, useRef, memo } from 'react';
import { useI18n } from '../i18n.jsx';

const TradingViewWidget = ({ 
  symbol = 'BINANCE:ETHUSDT',
  interval = '1D',
  theme = 'dark',
  style = '1',
  locale = null,
  toolbar_bg = '#f1f3f6',
  enable_publishing = false,
  allow_symbol_change = true,
  onError = null,
  height = 400
}) => {
  const { lang } = useI18n();
  const container = useRef(null);
  // 使用稳定且唯一的容器ID，确保TradingView能正确挂载。
  const containerIdRef = useRef(`tv_widget_${Math.random().toString(36).slice(2)}`);

  // 根据当前语言设置TradingView的locale
  const tradingViewLocale = locale || (lang === 'pl' ? 'es' : 'en');

  // 取消“仅初始化一次”的优化，改为在依赖变化时安全地卸载并重新初始化。
  // 使用 tv.js 方式嵌入，绕过 tradingview-widget.com 的重定向
  const tvjsId = 'tradingview-tvjs-script';
  const failOnceRef = useRef(false);

  useEffect(() => {
    // 监听全局错误与未处理的 Promise 拒绝，捕获 TradingView/bento 初始化相关错误
    const globalErrorHandler = (evt) => {
      try {
        const rawMsg = evt?.message || evt?.error?.message || evt?.error || '';
        const msg = String(rawMsg).toLowerCase();
        // 更强的匹配：捕获“Cannot access tv before initialization”等旧嵌入错误
        const isTvInitTDZ = msg.includes('cannot access tv before initialization') || /cannot\s+access\s+tv\b/i.test(msg);
        const isTvRelated = isTvInitTDZ || msg.includes('tradingview') || msg.includes('tv.js') || msg.includes('widget') || msg.includes('bento');
        if (isTvRelated && onError && !failOnceRef.current) {
          failOnceRef.current = true;
          const displayMsg = rawMsg || 'TradingView initialization error';
          onError(new Error(displayMsg));
          // 阻止事件冒泡与默认行为，避免 ErrorBoundary 接管全局
          if (evt?.preventDefault) evt.preventDefault();
          if (evt?.stopPropagation) evt.stopPropagation();
          return true;
        }
      } catch {}
      return false;
    };
    const globalRejectionHandler = (evt) => {
      try {
        const rawMsg = evt?.reason?.message || evt?.reason || '';
        const msg = String(rawMsg).toLowerCase();
        const isTvInitTDZ = msg.includes('cannot access tv before initialization') || /cannot\s+access\s+tv\b/i.test(msg);
        const isTvRelated = isTvInitTDZ || msg.includes('tradingview') || msg.includes('tv.js') || msg.includes('widget') || msg.includes('bento');
        if (isTvRelated && onError && !failOnceRef.current) {
          failOnceRef.current = true;
          onError(new Error(rawMsg || 'TradingView initialization error'));
          if (evt?.preventDefault) evt.preventDefault();
          if (evt?.stopPropagation) evt.stopPropagation();
          return true;
        }
      } catch {}
      return false;
    };
    try {
      window.addEventListener('error', globalErrorHandler, true);
      window.addEventListener('unhandledrejection', globalRejectionHandler, true);
    } catch {}

    // —— 每次依赖改变时，先做完整卸载 ——
    try {
      // 清理本容器内容
      if (container.current) {
        container.current.innerHTML = '';
      }
    } catch {}

    // 准备容器
    const innerDiv = document.createElement('div');
    const cid = containerIdRef.current;
    innerDiv.id = cid;
    innerDiv.style.height = `${height}px`;
    innerDiv.style.width = '100%';
    container.current?.appendChild(innerDiv);
    const cleanupContainer = container.current;

    // 创建/复用 tv.js
    const ensureInit = () => {
      try {
        if (!window.TradingView) return false;
        // 使用 autosize，避免固定宽高导致布局问题
        const containerId = cid;
        new window.TradingView.widget({
          autosize: true,
          symbol,
          interval,
          timezone: 'Etc/UTC',
          theme,
          style,
          locale: tradingViewLocale,
          toolbar_bg,
          enable_publishing,
          allow_symbol_change,
          container_id: containerId,
          withdateranges: true,
          hide_side_toolbar: false,
        });
        return true;
      } catch (e) {
        console.error('TradingView.widget init error:', e);
        // 若初始化抛错，仅第一次通过 onError 报告，避免连续弹错
        if (!failOnceRef.current && onError) {
          failOnceRef.current = true;
          onError(new Error('TradingView widget init error'));
        }
        return false;
      }
    };

    if (!ensureInit()) {
      let tvScript = document.getElementById(tvjsId);
      if (!tvScript) {
        tvScript = document.createElement('script');
        tvScript.id = tvjsId;
        tvScript.src = 'https://s3.tradingview.com/tv.js';
        tvScript.async = true;
        tvScript.onload = () => {
          const ok = ensureInit();
          if (!ok && onError && !failOnceRef.current) {
            failOnceRef.current = true;
            onError(new Error('TradingView tv.js init failed'));
          }
        };
        tvScript.onerror = () => {
          console.error('TradingView tv.js failed to load');
          if (onError && !failOnceRef.current) {
            failOnceRef.current = true;
            onError(new Error('TradingView tv.js failed to load'));
          }
        };
        document.body.appendChild(tvScript);
      } else {
        // 如果脚本已存在但 TradingView 尚未可用，等待短暂时间再试
        const retryTimer = setTimeout(() => {
          const ok = ensureInit();
          if (!ok && onError && !failOnceRef.current) {
            failOnceRef.current = true;
            onError(new Error('TradingView tv.js not ready'));
          }
        }, 1200);
        // 保存清理到容器
        if (container.current) {
          container.current.__tvCleanup = () => clearTimeout(retryTimer);
        }
      }
    }

    // 渲染超时检测：8秒后仍无 iframe，触发 onError（用于智能回退）
    const renderTimeout = setTimeout(() => {
      try {
        const node = document.getElementById(cid);
        const hasIframe = !!node?.querySelector('iframe');
        if (!hasIframe && onError && !failOnceRef.current) {
          failOnceRef.current = true;
          onError(new Error('TradingView render timeout'));
        }
      } catch {}
    }, 8000);

    // 保存清理函数
    if (cleanupContainer) {
      const prevCleanup = cleanupContainer.__tvCleanup;
      cleanupContainer.__tvCleanup = () => {
        try { prevCleanup?.(); } catch {}
        clearTimeout(renderTimeout);
      };
    }

    return () => {
      try {
        const node = document.getElementById(cid);
        if (node && node.parentNode) node.parentNode.removeChild(node);
      } catch {}
      try { cleanupContainer?.__tvCleanup?.(); } catch {}
      // 移除全局事件监听，避免内存泄漏与重复回调
      try {
        window.removeEventListener('error', globalErrorHandler, true);
        window.removeEventListener('unhandledrejection', globalRejectionHandler, true);
      } catch {}
    };
  }, [symbol, interval, theme, style, lang, tradingViewLocale, toolbar_bg, enable_publishing, allow_symbol_change, onError, height]);

  return (
    <div 
      className="tradingview-widget-container"
      style={{ height: `${height}px`, width: "100%" }}
      key={`tv-container-${tradingViewLocale}`}
    >
      <div 
        className="tradingview-widget" 
        ref={container}
        key={tradingViewLocale}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
};

export default memo(TradingViewWidget);