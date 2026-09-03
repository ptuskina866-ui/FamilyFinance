// ── Polyfills for iOS Safari (WebKit) ──
if (typeof ReadableStream !== 'undefined' && !(ReadableStream.prototype as any)[Symbol.asyncIterator]) {
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve: any, reject: any;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Global error logging (ignoring harmless native browser / share sheet cross-origin errors)
window.addEventListener('error', (event) => {
  if (!event.message || event.message.toLowerCase().includes('script error') || !event.filename) {
    console.warn('Ignored external browser script event:', event);
    return;
  }
  console.error('Window Error:', event);
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason || '');
  if (!msg || msg.toLowerCase().includes('script error') || msg.includes('AbortError')) {
    return;
  }
  console.error('Promise Rejection:', event);
});

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
// Register PWA service worker if available in production
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('PWA ServiceWorker registered successfully:', reg.scope);
      })
      .catch((err) => {
        console.warn('PWA ServiceWorker registration failed:', err);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
