import { useQuery } from '@tanstack/react-query';

import { api, type InitStatus } from '../api.js';

/**
 * First-run gate. Checks both backend readiness and initialization state so
 * the user is routed to the correct screen (init vs. login vs. app).
 */
export function useInitGate(): {
  initialized: boolean | null;
  loading: boolean;
  error: Error | null;
} {
  const ready = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ status: string }>('/health/ready'),
    retry: 2,
  });

  const status = useQuery<InitStatus>({
    queryKey: ['init-status'],
    queryFn: () => api.get<InitStatus>('/auth/init-status'),
    enabled: ready.data?.status === 'ok',
  });

  if (ready.isError) {
    return { initialized: null, loading: false, error: ready.error };
  }
  if (ready.isLoading) {
    return { initialized: null, loading: true, error: null };
  }
  if (ready.data?.status !== 'ok') {
    return {
      initialized: null,
      loading: false,
      error: new Error(`Backend is not ready (status: ${ready.data?.status ?? 'unknown'}).`),
    };
  }
  if (status.isError) {
    return { initialized: null, loading: false, error: status.error };
  }
  if (status.isLoading) {
    return { initialized: null, loading: true, error: null };
  }
  if (status.data === undefined) {
    return {
      initialized: null,
      loading: false,
      error: new Error('Initialization status was not returned by the backend.'),
    };
  }
  return { initialized: status.data.initialized, loading: false, error: null };
}
