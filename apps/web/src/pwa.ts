export const PWA_UPDATE_READY_EVENT = 'bullion-ledger:pwa-update-ready';

let pendingRegistration: ServiceWorkerRegistration | null = null;
let reloadAfterActivation = false;

export function registerPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      });
      pendingRegistration = registration.waiting ? registration : null;
      if (registration.waiting && navigator.serviceWorker.controller) announceUpdate(registration);

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdate(registration);
          }
        });
      });

      const checkForUpdate = () => {
        if (document.visibilityState === 'visible') {
          void registration.update().catch((error: unknown) => {
            console.warn('Unable to check for a Bullion Ledger update.', error);
          });
        }
      };
      document.addEventListener('visibilitychange', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
    } catch (error) {
      console.warn('Bullion Ledger could not register its offline shell.', error);
    }
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadAfterActivation) return;
    reloadAfterActivation = false;
    window.location.reload();
  });

  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

export function isPwaUpdateReady(): boolean {
  return Boolean(pendingRegistration?.waiting);
}

export function applyPwaUpdate(): boolean {
  const worker = pendingRegistration?.waiting;
  if (!worker) return false;
  reloadAfterActivation = true;
  worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

function announceUpdate(registration: ServiceWorkerRegistration): void {
  pendingRegistration = registration;
  window.dispatchEvent(new Event(PWA_UPDATE_READY_EVENT));
}
