import type { AuthUser } from "./auth-api";

type DisplayUser = Pick<AuthUser, "username"> &
  Partial<Pick<AuthUser, "nickname">>;

export function getUserDisplayName(user: DisplayUser): string {
  return user.nickname?.trim() || user.username;
}

export function getAvatarFallbackText(user: DisplayUser): string {
  return getNamedFallbackText(getUserDisplayName(user));
}

export function getNamedFallbackText(value: string, fallback = "?"): string {
  const characters = Array.from(value.trim());
  return characters.slice(-2).join("").toUpperCase() || fallback;
}
