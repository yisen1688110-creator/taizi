import React from 'react';

export function IconMexico({ className = '', size = 18 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="6" fill="#1b2a45" stroke="#2e4a7f" strokeWidth="1" />
      <rect x="4" y="8" width="5.8" height="8" rx="2" fill="#2ecc71" />
      <rect x="9.8" y="8" width="5.4" height="8" rx="2" fill="#ecf0f1" />
      <rect x="15.2" y="8" width="4.8" height="8" rx="2" fill="#e74c3c" />
    </svg>
  );
}

export function IconUS({ className = '', size = 18 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="6" fill="#1b2a45" stroke="#2e4a7f" strokeWidth="1" />
      <rect x="4" y="8" width="7" height="4.5" rx="2" fill="#34495e" />
      <circle cx="6.8" cy="10.2" r="0.7" fill="#a8c5ff" />
      <circle cx="8.8" cy="10.2" r="0.7" fill="#a8c5ff" />
      <circle cx="6.8" cy="12" r="0.7" fill="#a8c5ff" />
      <circle cx="8.8" cy="12" r="0.7" fill="#a8c5ff" />
      <rect x="11.8" y="8" width="6.2" height="1.8" rx="1" fill="#e74c3c" />
      <rect x="11.8" y="10.3" width="6.2" height="1.8" rx="1" fill="#ecf0f1" />
      <rect x="11.8" y="12.6" width="6.2" height="1.8" rx="1" fill="#e74c3c" />
      <rect x="11.8" y="14.9" width="6.2" height="1.8" rx="1" fill="#ecf0f1" />
    </svg>
  );
}

export function IconCrypto({ className = '', size = 18 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="coinGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5b8def" />
          <stop offset="100%" stopColor="#7fd7ff" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="8" fill="url(#coinGrad)" opacity="0.45" />
      <circle cx="12" cy="12" r="7" fill="#1b2a45" stroke="#5b8def" strokeWidth="1.2" />
      <text x="12" y="15" fontSize="9" textAnchor="middle" fill="#a8c5ff" fontFamily="system-ui, -apple-system, Segoe UI, Roboto">₿</text>
    </svg>
  );
}

export function IconLightning({ className = '', size = 20 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="lightBolt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd54f" />
          <stop offset="100%" stopColor="#ffeb3b" />
        </linearGradient>
      </defs>
      <path d="M13 3L6 13h5l-2 8 9-12h-5l0-6z" fill="url(#lightBolt)" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconHome({ className = '', size = 18 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 10.5L12 4l9 6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 11.5V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="9.5" y="14" width="5" height="4.8" rx="1.2" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

export function IconMarket({ className = '', size = 18 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="4" y="11" width="3" height="7" rx="1" fill="currentColor" opacity="0.6" />
      <rect x="9.5" y="7" width="3" height="11" rx="1" fill="currentColor" opacity="0.8" />
      <rect x="15" y="9" width="3" height="9" rx="1" fill="currentColor" opacity="0.6" />
      <path d="M3.5 20.5h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

export function IconSwap({ className = '', size = 18 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7 7h8l-2.6-2.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 17H9l2.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.35" />
    </svg>
  );
}

export function IconBell({ className = '', size = 18 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 4a5 5 0 0 1 5 5v3.6l1.8 2.9c.3.5 0 1.1-.6 1.1H5.8c-.6 0-.9-.6-.6-1.1L7 12.6V9a5 5 0 0 1 5-5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 19.2c.5.9 1.4 1.4 2 1.4s1.5-.5 2-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUser({ className = '', size = 18 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 19.5c1.8-3.4 5-5.2 7.5-5.2s5.7 1.8 7.5 5.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// Linear icons for Institution page
export function IconBank({ className = '', size = 24 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 9l8-5 8 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 11v7M10 11v7M14 11v7M18 11v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconTradeLinear({ className = '', size = 24 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 4v16h16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 15l4-4 3 3 5-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconIPO({ className = '', size = 24 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="5" y="3" width="12" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 13l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19 8v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconShield({ className = '', size = 24 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 3l7 3v5c0 5-3.5 7.5-7 10-3.5-2.5-7-5-7-10V6l7-3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 11l3 3 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default { IconMexico, IconUS, IconCrypto, IconLightning, IconHome, IconMarket, IconSwap, IconBell, IconUser, IconBank, IconTradeLinear, IconIPO, IconShield };