import type { AuthUser } from "./auth-api";

type DisplayUser = Pick<AuthUser, "username"> &
  Partial<Pick<AuthUser, "nickname">>;

export function getUserDisplayName(user: DisplayUser): string {
  return user.nickname?.trim() || user.username;
}

export function getAvatarFallbackText(user: DisplayUser): string {
  const characters = Array.from(getUserDisplayName(user));
  return characters.slice(-2).join("").toUpperCase();
}
