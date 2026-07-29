import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App.js';
import { registerPwa } from './pwa.js';
import { ThemeProvider } from './ThemeProvider.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

// Development stays deterministic: Vite HMR and a service worker never
// compete for module requests. Production registers a conservative shell and
// asks before activating an update so an in-progress intake is not reloaded.
registerPwa();
