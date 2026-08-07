import type { Response } from "express";
import { randomBytes } from "node:crypto";

export const TRUSTED_DEVICE_COOKIE_NAME = "hlovet_trusted_device";
const TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function readTrustedDeviceToken(
  cookieHeader?: string,
): string | undefined {
  if (!cookieHeader) return undefined;

  const value = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`))
    ?.slice(TRUSTED_DEVICE_COOKIE_NAME.length + 1);
  if (!value) return undefined;

  try {
    const decoded = decodeURIComponent(value);
    return /^[A-Za-z0-9_-]{32,128}$/.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function createTrustedDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setTrustedDeviceCookie(
  response: Response,
  token: string,
): void {
  const secure =
    process.env.NODE_ENV === "production" ||
    (process.env.WEB_ORIGIN ?? "")
      .split(",")
      .some((origin) => origin.trim().startsWith("https://"));
  const attributes = [
    `${TRUSTED_DEVICE_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  response.appendHeader("Set-Cookie", attributes.join("; "));
}
