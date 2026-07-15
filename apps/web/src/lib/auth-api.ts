import type { ThemeId } from "./theme-preferences";

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
    (error.status === 401 || error.status === 403)
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

  const response = await fetch(`${getBrowserApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new ApiRequestError(
      await readErrorMessage(response),
      response.status,
    );
  }

  return response.json() as Promise<T>;
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
