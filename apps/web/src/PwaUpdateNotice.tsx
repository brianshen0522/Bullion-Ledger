import { useEffect, useState } from 'react';

import { applyPwaUpdate, isPwaUpdateReady, PWA_UPDATE_READY_EVENT } from './pwa.js';

export function PwaUpdateNotice() {
  const [ready, setReady] = useState(isPwaUpdateReady);

  useEffect(() => {
    const show = () => setReady(true);
    window.addEventListener(PWA_UPDATE_READY_EVENT, show);
    if (isPwaUpdateReady()) setReady(true);
    return () => window.removeEventListener(PWA_UPDATE_READY_EVENT, show);
  }, []);

  if (!ready) return null;
  return (
    <section
      role="status"
      className="safe-area-inline border-b border-teal-200 bg-teal-50 py-2 text-sm text-teal-950 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-100"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2">
        <p className="mr-auto">新版 Bullion Ledger 已準備完成，立即更新會重新啟動 App。</p>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 font-medium text-white"
          onClick={() => {
            if (!applyPwaUpdate()) window.location.reload();
          }}
        >
          立即更新
        </button>
        <button
          type="button"
          className="rounded-lg px-3 font-medium text-teal-800 dark:text-teal-200"
          onClick={() => setReady(false)}
        >
          稍後
        </button>
      </div>
    </section>
  );
}
