import Constants from 'expo-constants';
import { router } from 'expo-router';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from '@/auth/session';

const BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  'http://localhost:3000/api/v1';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return null;
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      await saveTokens(body.accessToken, body.refreshToken);
      return body.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function rawRequest<T>(
  path: string,
  init: RequestInit,
  token: string | null,
): Promise<{ ok: true; body: T } | { ok: false; status: number; body: unknown }> {
  const isFormData =
    typeof FormData !== 'undefined' && init.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'content-type': 'application/json' }),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
  return { ok: true, body: body as T };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isAuthEndpoint = path.startsWith('/auth/');
  let token = await getAccessToken();
  let res = await rawRequest<T>(path, init, token);

  if (!res.ok && res.status === 401 && !isAuthEndpoint) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      res = await rawRequest<T>(path, init, fresh);
    } else {
      await clearTokens();
      try {
        router.replace('/(auth)/login');
      } catch {
        // router not ready yet; caller will surface the error.
      }
    }
  }

  if (!res.ok) {
    const msg =
      typeof res.body === 'object' && res.body !== null && 'message' in (res.body as any)
        ? String((res.body as any).message)
        : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, res.body);
  }
  return res.body;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  upload: <T>(p: string, form: FormData) =>
    request<T>(p, { method: 'POST', body: form as unknown as BodyInit }),
};
