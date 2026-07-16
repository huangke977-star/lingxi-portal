import type { ThemeId } from "./theme-preferences";
import {
  AUTH_STATE_CHANGE_EVENT,
  clearAuthTokens,
  readAccessToken,
  readRefreshToken,
  saveAuthTokens,
} from "./auth-storage";

const CONFIGURED_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "auto";

export interface AuthRole {
  code: string;
  name: string;
  level: number;
}

export interface AuthAppearance {
  themeId: ThemeId;
  customAccent: string;
  customSurface: string;
  customForeground: string;
  customMuted: string;
  cardAlpha: number;
  glassBlur: number;
  glassTint: string;
  glassTintAlpha: number;
}

export interface AuthUser {
  id: number;
  username: string;
  nickname: string;
  email: string;
  status: "active" | "disabled";
  isSuperAdmin: boolean;
  avatarUrl: string | null;
  profileBio: string;
  createdAt: string;
  appearance: AuthAppearance;
  role: AuthRole;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export interface AuthSession {
  id: string;
  issuedAt: string;
  expiresAt: string;
  ip: string;
  userAgent: string;
  current: boolean;
}

interface ApiErrorBody {
  message?: string | string[];
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isAuthExpiredError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.status === 401
  );
}

export async function login(input: {
  account: string;
  password: string;
}): Promise<AuthResponse> {
  const response = await requestJson<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return normalizeAuthResponse(response);
}

export async function register(input: {
  username: string;
  nickname: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const response = await requestJson<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return normalizeAuthResponse(response);
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  const response = await requestJson<AuthResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });

  return normalizeAuthResponse(response);
}

export async function logout(refreshToken: string): Promise<void> {
  await requestJson<{ success: true }>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export async function listMySessions(
  accessToken: string,
): Promise<AuthSession[]> {
  const result = await requestJson<{ sessions: AuthSession[] }>(
    "/auth/sessions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  return result.sessions;
}

export async function revokeOtherSessions(
  accessToken: string,
): Promise<number> {
  const result = await requestJson<{ revokedSessions: number }>(
    "/auth/sessions/revoke-others",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  return result.revokedSessions;
}

export async function revokeAllSessions(accessToken: string): Promise<number> {
  const result = await requestJson<{ revokedSessions: number }>(
    "/auth/sessions/revoke-all",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  return result.revokedSessions;
}

export async function getMe(accessToken: string): Promise<AuthUser> {
  const user = await requestJson<AuthUser>("/auth/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return normalizeAuthUser(user);
}

export async function updateMyAppearance(
  accessToken: string,
  appearance: AuthAppearance,
): Promise<AuthUser> {
  const user = await requestJson<AuthUser>("/auth/me/appearance", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(appearance),
  });

  return normalizeAuthUser(user);
}

export async function updateMyProfile(
  accessToken: string,
  input: { nickname: string; email: string; profileBio: string },
): Promise<AuthUser> {
  const user = await requestJson<AuthUser>("/auth/me/profile", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });

  const normalizedUser = normalizeAuthUser(user);
  const expectedNickname = input.nickname.trim();
  const expectedEmail = input.email.trim().toLowerCase();

  if (
    normalizedUser.nickname !== expectedNickname ||
    normalizedUser.email.toLowerCase() !== expectedEmail
  ) {
    throw new Error("当前服务器尚未更新个人资料接口，请部署新版后端后再重试。");
  }

  return normalizedUser;
}

export async function uploadMyAvatar(
  accessToken: string,
  file: File,
): Promise<AuthUser> {
  const body = new FormData();
  body.append("file", file);

  const user = await requestJson<AuthUser>("/auth/me/avatar", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body,
  });

  return normalizeAuthUser(user);
}

export function normalizeAuthUser(user: AuthUser): AuthUser {
  return {
    ...user,
    nickname: user.nickname?.trim() || user.username,
  };
}

function normalizeAuthResponse(response: AuthResponse): AuthResponse {
  return {
    ...response,
    user: normalizeAuthUser(response.user),
  };
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response = await fetch(`${getBrowserApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  if (
    response.status === 401 &&
    path !== "/auth/refresh" &&
    headers.has("Authorization") &&
    readRefreshToken()
  ) {
    const session = await refreshStoredSession();
    if (session) {
      headers.set("Authorization", `Bearer ${session.accessToken}`);
      response = await fetch(`${getBrowserApiBaseUrl()}${path}`, {
        ...init,
        headers,
      });
    }
  }

  if (!response.ok) {
    throw new ApiRequestError(
      await readErrorMessage(response),
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

interface StoredSessionTokens {
  accessToken: string;
  refreshToken: string;
}

interface RefreshLock {
  owner: string;
  expiresAt: number;
}

const REFRESH_LOCK_KEY = "hlovet_refresh_lock";
const REFRESH_LOCK_DURATION_MS = 12_000;
let refreshOwnerId = "";
let refreshPromise: Promise<StoredSessionTokens | null> | null = null;

export function refreshStoredSession(): Promise<StoredSessionTokens | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  if (!refreshPromise) {
    refreshPromise = performStoredSessionRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function performStoredSessionRefresh(): Promise<StoredSessionTokens | null> {
  const initialRefreshToken = readRefreshToken();
  if (!initialRefreshToken) {
    return null;
  }

  const owner = getRefreshOwnerId();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!tryAcquireRefreshLock(owner)) {
      const updated = await waitForAnotherTabRefresh(initialRefreshToken);
      if (updated || !readRefreshToken()) {
        return updated;
      }
      continue;
    }

    try {
      const latestRefreshToken = readRefreshToken();
      if (!latestRefreshToken) {
        return null;
      }
      if (latestRefreshToken !== initialRefreshToken) {
        return readStoredSessionTokens();
      }

      const response = await refresh(latestRefreshToken);
      saveAuthTokens(response);
      return {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
      };
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        (error.status === 401 || error.status === 403)
      ) {
        clearAuthTokens();
        throw new ApiRequestError("登录状态已过期，请重新登录。", 401);
      }
      throw error;
    } finally {
      releaseRefreshLock(owner);
    }
  }

  return readStoredSessionTokens();
}

function readStoredSessionTokens(): StoredSessionTokens | null {
  const accessToken = readAccessToken();
  const refreshToken = readRefreshToken();
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

function getRefreshOwnerId(): string {
  if (!refreshOwnerId) {
    refreshOwnerId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return refreshOwnerId;
}

function tryAcquireRefreshLock(owner: string): boolean {
  const now = Date.now();
  const existing = readRefreshLock();
  if (existing && existing.owner !== owner && existing.expiresAt > now) {
    return false;
  }

  const next: RefreshLock = {
    owner,
    expiresAt: now + REFRESH_LOCK_DURATION_MS,
  };
  window.localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify(next));
  const confirmed = readRefreshLock();
  return confirmed?.owner === owner;
}

function releaseRefreshLock(owner: string): void {
  if (readRefreshLock()?.owner === owner) {
    window.localStorage.removeItem(REFRESH_LOCK_KEY);
  }
}

function readRefreshLock(): RefreshLock | null {
  const value = window.localStorage.getItem(REFRESH_LOCK_KEY);
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as RefreshLock;
    return typeof parsed.owner === "string" &&
      typeof parsed.expiresAt === "number"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function waitForAnotherTabRefresh(
  previousRefreshToken: string,
): Promise<StoredSessionTokens | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      const currentRefreshToken = readRefreshToken();
      if (
        currentRefreshToken === previousRefreshToken &&
        Date.now() < (readRefreshLock()?.expiresAt ?? 0)
      ) {
        return;
      }
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener("storage", check);
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, check);
      resolve(
        currentRefreshToken !== previousRefreshToken
          ? readStoredSessionTokens()
          : null,
      );
    };
    const check = () => finish();
    const interval = window.setInterval(finish, 250);
    const timeout = window.setTimeout(() => {
      window.localStorage.removeItem(REFRESH_LOCK_KEY);
      finish();
    }, REFRESH_LOCK_DURATION_MS + 500);
    window.addEventListener("storage", check);
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, check);
  });
}

export function getBrowserApiBaseUrl(): string {
  if (CONFIGURED_API_BASE_URL !== "auto") {
    return CONFIGURED_API_BASE_URL;
  }

  if (typeof window !== "undefined") {
    if (window.location.port === "3000") {
      return `${window.location.protocol}//${window.location.hostname}:3001`;
    }

    return `${window.location.origin}/api`;
  }

  return "http://localhost:3001";
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${getBrowserApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `请求失败，状态码 ${response.status}`;

  try {
    const body = (await response.json()) as ApiErrorBody;
    if (Array.isArray(body.message)) {
      return body.message[0] ?? fallback;
    }

    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
