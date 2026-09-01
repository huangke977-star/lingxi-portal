export const sensitiveActionValues = [
  "account_deletion",
  "passkey_registration",
  "totp_enrollment",
] as const;

export type SensitiveAction = (typeof sensitiveActionValues)[number];

export function parseSensitiveAction(value: string): SensitiveAction {
  if ((sensitiveActionValues as readonly string[]).includes(value)) {
    return value as SensitiveAction;
  }
  throw new Error(`Unsupported sensitive action: ${value}`);
}
