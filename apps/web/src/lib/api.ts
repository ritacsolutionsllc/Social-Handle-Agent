'use client';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  status: number;
}

function csrfToken(): string {
  return document.cookie.split('; ').find((c) => c.startsWith('sha_csrf='))?.slice('sha_csrf='.length) ?? '';
}

/** JSON fetch with CSRF header; throws ApiError with the server's typed error body. */
export async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrfToken()) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: Omit<ApiError, 'status'>; requestId?: string };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth/')) window.location.href = '/login';
    throw { status: res.status, requestId: data.requestId, ...(data.error ?? { code: 'internal_error', message: `Request failed (${res.status})` }) } as ApiError;
  }
  return data as T;
}

export const isApiError = (e: unknown): e is ApiError => typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
