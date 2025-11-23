// Global TradingView error guard
// Goal: prevent benign TradingView init/TDZ errors from triggering React ErrorBoundary overlay.
// It should be imported as early as possible in the app entry.

(function installTvGuard(){
  if (typeof window === 'undefined') return;
  if (window.__tvGuardInstalled) return;
  window.__tvGuardInstalled = true;

  const isBenignTvError = (raw) => {
    try {
      const msg = String(raw?.message || raw || '').toLowerCase();
      // 兼容多语言/多写法：英文/西语等
      const tdzEn = msg.includes('cannot access tv before initialization')
        || /cannot\s+access\s+['"]?tv['"]?\s+before\s+initialization/i.test(msg)
        || /cannot\s+access\s+tv\b/i.test(msg);
      const tdzEs = /no\s+se\s+puede\s+acceder\s+a\s+tv\s+antes\s+de\s+la\s+inicializaci[óo]n/i.test(msg);
      const tvUndefined = /(\btv\b|tradingview)\s+is\s+not\s+defined/i.test(msg)
        || /(\btv\b|tradingview)\s+no\s+est[áa]\s+definido/i.test(msg);
      const mentions = msg.includes('tradingview') || msg.includes('tv.js') || msg.includes('tradingview.com')
        || msg.includes('embed-widget') || msg.includes('symbol-overview') || msg.includes('bento') || msg.includes('widget');
      return tdzEn || tdzEs || tvUndefined || mentions;
    } catch(_) { return false; }
  };

  const onErr = (evt) => {
    try {
      const raw = evt?.message || evt?.error?.message || evt?.error || '';
      if (isBenignTvError(raw)) {
        if (evt?.preventDefault) evt.preventDefault();
        if (evt?.stopPropagation) evt.stopPropagation();
        return true;
      }
    } catch {}
    return false;
  };

  const onRej = (evt) => {
    try {
      const raw = evt?.reason?.message || evt?.reason || '';
      if (isBenignTvError(raw)) {
        if (evt?.preventDefault) evt.preventDefault();
        if (evt?.stopPropagation) evt.stopPropagation();
        return true;
      }
    } catch {}
    return false;
  };

  try {
    window.addEventListener('error', onErr, true);
    window.addEventListener('unhandledrejection', onRej, true);
    // 兜底：拦截旧式 window.onerror/window.onunhandledrejection 赋值回调
    const origOnError = window.onerror;
    window.onerror = function(message, source, lineno, colno, error){
      try { if (isBenignTvError(error || message)) return true; } catch {}
      if (typeof origOnError === 'function') {
        try { return origOnError.apply(this, arguments); } catch {}
      }
      return false;
    };
    const origOnRejection = window.onunhandledrejection;
    window.onunhandledrejection = function(event){
      try { if (isBenignTvError(event?.reason)) return true; } catch {}
      if (typeof origOnRejection === 'function') {
        try { return origOnRejection.apply(this, arguments); } catch {}
      }
      return false;
    };
  } catch {}
})();