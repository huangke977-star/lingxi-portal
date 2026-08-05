export const ACCESS_TOKEN_KEY = 'lingxi_access_token';
export const REFRESH_TOKEN_KEY = 'lingxi_refresh_token';
export const AUTH_STATE_CHANGE_EVENT = 'hlovet_auth_state_change';

interface AccessTokenPayload {
  exp?: unknown;
  sub?: unknown;
}

export function saveAuthTokens(tokens: { accessToken: string; refreshToken: string }): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
}

export function readAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function readRefreshToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function readAccessTokenExpiresAt(): number | null {
  const payload = readAccessTokenPayload();
  return typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
}

export function readAccessTokenUserId(): number | null {
  const payload = readAccessTokenPayload();
  const userId = typeof payload?.sub === 'number' ? payload.sub : Number(payload?.sub);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export function clearAuthTokens(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
}

function readAccessTokenPayload(): AccessTokenPayload | null {
  const token = readAccessToken();
  const encodedPayload = token?.split('.')[1];
  if (!encodedPayload) return null;

  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    return JSON.parse(window.atob(padded)) as AccessTokenPayload;
  } catch {
    return null;
  }
}
