'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="app-shell" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="notice error" role="alert" style={{ flexDirection: 'column', alignItems: 'flex-start', maxWidth: 440, margin: 0 }}>
        <strong>页面出了点问题</strong>
        <p style={{ margin: '8px 0 16px' }}>这台设备上已保存的训练记录不受影响。可以重试，或返回首页。</p>
        <div style={{ display: 'flex', gap: 16 }}>
          <button className="quiet-action" type="button" onClick={reset}>重试</button>
          <button className="quiet-action" type="button" onClick={() => { window.location.href = '/'; }}>返回首页</button>
        </div>
      </div>
    </div>
  );
}
