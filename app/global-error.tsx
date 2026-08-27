'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body style={{
        margin: 0,
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f4f1e8',
        color: '#16271f',
        fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
      >
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 400 }}>
          <strong style={{ fontSize: 18 }}>讲清楚遇到了问题</strong>
          <p style={{ color: '#66736d', margin: '8px 0 20px' }}>请重试；这台设备上已保存的训练记录不受影响。</p>
          <button
            type="button"
            onClick={reset}
            style={{ minHeight: 44, padding: '10px 20px', borderRadius: 8, border: 0, background: '#16271f', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
