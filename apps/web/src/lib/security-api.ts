import { requestJson } from "./auth-api";

export interface SecurityPolicy {
  registrationEmailVerificationEnabled: boolean;
  passwordRecoveryEnabled: boolean;
  turnstile: {
    siteKey: string;
    registrationEnabled: boolean;
    loginEnabled: boolean;
    recoveryEnabled: boolean;
    loginFailureThreshold: number;
  };
}

export interface SecurityPreferences {
  loginAlertsEnabled: boolean;
  emailAlertsEnabled: boolean;
  newDeviceAlertsEnabled: boolean;
}

export interface SecurityEvent {
  id: string | number;
  type: string;
  riskLevel: "low" | "medium" | "high" | "critical" | string;
  summary: string;
  ip: string;
  deviceLabel: string;
  createdAt: string;
}

export interface TrustedDevice {
  id: string | number;
  deviceId?: string;
  deviceLabel?: string;
  label?: string;
  ip?: string;
  firstIp?: string;
  lastIp?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  trustedAt?: string;
  current?: boolean;
}

export interface MySecurityOverview {
  emailVerifiedAt: string | null;
  preferences: SecurityPreferences;
  events: SecurityEvent[];
  trustedDevices: TrustedDevice[];
}

export interface SecurityAdminConfig {
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword?: string;
  smtpPasswordConfigured: boolean;
  smtpFromName: string;
  smtpFromEmail: string;
  registrationEmailVerificationEnabled: boolean;
  passwordRecoveryEnabled: boolean;
  turnstileSiteKey: string;
  turnstileSecret?: string;
  turnstileSecretConfigured: boolean;
  turnstileRegistrationEnabled: boolean;
  turnstileLoginEnabled: boolean;
  turnstileRecoveryEnabled: boolean;
  loginFailureTurnstileThreshold: number;
  encryptionConfigured: boolean;
  updatedAt: string;
}

export type SecurityAdminConfigUpdate = Pick<
  SecurityAdminConfig,
  | "smtpEnabled"
  | "smtpHost"
  | "smtpPort"
  | "smtpSecure"
  | "smtpUsername"
  | "smtpFromName"
  | "smtpFromEmail"
  | "registrationEmailVerificationEnabled"
  | "passwordRecoveryEnabled"
  | "turnstileSiteKey"
  | "turnstileRegistrationEnabled"
  | "turnstileLoginEnabled"
  | "turnstileRecoveryEnabled"
  | "loginFailureTurnstileThreshold"
> & {
  smtpPassword?: string;
  turnstileSecret?: string;
};

export type SecurityAdminTab =
  | "mail-jobs"
  | "verification-codes"
  | "risk-events";

export interface SecurityAdminOverviewItem {
  id: string | number;
  type?: string;
  status?: string;
  email?: string;
  recipient?: string;
  subject?: string;
  purpose?: string;
  summary?: string;
  riskLevel?: string;
  ip?: string;
  deviceLabel?: string;
  attempts?: number;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  sentAt?: string;
  usedAt?: string;
  verifiedAt?: string | null;
  consumedAt?: string | null;
  user?: {
    id?: number;
    username?: string;
    nickname?: string;
  } | null;
  [key: string]: unknown;
}

export interface SecurityAdminOverviewPage {
  items: SecurityAdminOverviewItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function getSecurityPolicy(): Promise<SecurityPolicy> {
  return requestJson("/auth/security-policy", { cache: "no-store" });
}

export function requestRegistrationCode(
  email: string,
  turnstileToken?: string,
): Promise<{ success: true; retryAfterSeconds: number }> {
  return requestJson("/auth/registration-code", {
    method: "POST",
    body: JSON.stringify({ email, turnstileToken }),
  });
}

export function requestPasswordRecovery(
  email: string,
  turnstileToken?: string,
): Promise<{ success: true }> {
  return requestJson("/auth/password-recovery/request", {
    method: "POST",
    body: JSON.stringify({ email, turnstileToken }),
  });
}

export function resetPassword(input: {
  token: string;
  newPassword: string;
  turnstileToken?: string;
}): Promise<{ success: true }> {
  return requestJson("/auth/password-recovery/reset", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getMySecurity(
  accessToken: string,
): Promise<MySecurityOverview> {
  return requestJson("/auth/me/security", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function updateMySecurityPreferences(
  accessToken: string,
  preferences: SecurityPreferences,
): Promise<SecurityPreferences> {
  return requestJson<SecurityPreferences | { preferences: SecurityPreferences }>(
    "/auth/me/security/preferences",
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(preferences),
    },
  ).then((response) =>
    "preferences" in response ? response.preferences : response,
  );
}

export function sendMyEmailVerification(
  accessToken: string,
): Promise<{ success: true; retryAfterSeconds?: number }> {
  return requestJson("/auth/me/email-verification/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function confirmMyEmailVerification(
  accessToken: string,
  code: string,
): Promise<{ success: true; emailVerifiedAt?: string }> {
  return requestJson("/auth/me/email-verification/confirm", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ code }),
  });
}

export function getSecurityAdminConfig(
  accessToken: string,
): Promise<SecurityAdminConfig> {
  return requestJson("/security-admin/config", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function updateSecurityAdminConfig(
  accessToken: string,
  config: SecurityAdminConfigUpdate,
): Promise<SecurityAdminConfig> {
  return requestJson("/security-admin/config", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(config),
  });
}

export function testSmtpConnection(
  accessToken: string,
): Promise<{ success: true; message?: string }> {
  return requestJson("/security-admin/smtp/test", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getSecurityAdminOverview(
  accessToken: string,
  query: {
    tab: SecurityAdminTab;
    page: number;
    pageSize: number;
    search?: string;
    status?: string;
  },
): Promise<SecurityAdminOverviewPage> {
  const params = new URLSearchParams();
  Object.entries({
    ...query,
    tab:
      query.tab === "mail-jobs"
        ? "mail"
        : query.tab === "verification-codes"
          ? "verification"
          : "risk",
  }).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });
  const response = await requestJson<
    SecurityAdminOverviewPage | { data: SecurityAdminOverviewPage }
  >(`/security-admin/overview?${params}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return "data" in response ? response.data : response;
}
