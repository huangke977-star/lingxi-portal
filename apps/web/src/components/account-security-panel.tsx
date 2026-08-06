"use client";

import {
  BadgeCheck,
  Clock3,
  Laptop,
  MailCheck,
  MailWarning,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  confirmMyEmailVerification,
  getMySecurity,
  sendMyEmailVerification,
  updateMySecurityPreferences,
  type MySecurityOverview,
  type SecurityEvent,
  type SecurityPreferences,
  type TrustedDevice,
} from "@/lib/security-api";

interface AccountSecurityPanelProps {
  email: string;
}

const preferenceOptions: Array<{
  key: keyof SecurityPreferences;
  label: string;
  description: string;
}> = [
  {
    key: "loginAlertsEnabled",
    label: "登录提醒",
    description: "记录并提醒账号登录动态",
  },
  {
    key: "emailAlertsEnabled",
    label: "邮件提醒",
    description: "将重要风险同步到邮箱",
  },
  {
    key: "newDeviceAlertsEnabled",
    label: "新设备提醒",
    description: "首次出现的设备单独提醒",
  },
];

export function AccountSecurityPanel({ email }: AccountSecurityPanelProps) {
  const router = useRouter();
  const [overview, setOverview] = useState<MySecurityOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingPreference, setSavingPreference] = useState<
    keyof SecurityPreferences | null
  >(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [isVerificationOpen, setIsVerificationOpen] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isConfirmingVerification, setIsConfirmingVerification] =
    useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSecurity = useCallback(async () => {
    const token = readAccessToken();
    if (!token) return;

    setIsLoading(true);
    try {
      setOverview(await getMySecurity(token));
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : "账号安全信息读取失败。",
      );
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSecurity(), 0);
    return () => window.clearTimeout(timer);
  }, [email, loadSecurity]);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(
      () => setRetryAfter((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  async function handlePreferenceChange(
    key: keyof SecurityPreferences,
    checked: boolean,
  ) {
    const token = readAccessToken();
    if (!token || !overview || savingPreference) return;

    const previousPreferences = overview.preferences;
    const nextPreferences = { ...previousPreferences, [key]: checked };
    setOverview({ ...overview, preferences: nextPreferences });
    setSavingPreference(key);
    setError("");
    setNotice("");
    try {
      const savedPreferences = await updateMySecurityPreferences(
        token,
        nextPreferences,
      );
      setOverview((current) =>
        current ? { ...current, preferences: savedPreferences } : current,
      );
      setNotice("安全提醒设置已更新。");
    } catch (saveError) {
      setOverview((current) =>
        current ? { ...current, preferences: previousPreferences } : current,
      );
      setError(
        saveError instanceof Error ? saveError.message : "设置更新失败。",
      );
    } finally {
      setSavingPreference(null);
    }
  }

  async function handleSendVerification() {
    const token = readAccessToken();
    if (!token || retryAfter > 0) return;

    setIsSendingVerification(true);
    setError("");
    setNotice("");
    try {
      const result = await sendMyEmailVerification(token);
      setIsVerificationOpen(true);
      setRetryAfter(Math.max(1, result.retryAfterSeconds || 60));
      setNotice("验证码已发送，请检查邮箱。");
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "验证码发送失败。",
      );
    } finally {
      setIsSendingVerification(false);
    }
  }

  async function handleConfirmVerification() {
    const token = readAccessToken();
    if (!token || !verificationCode.trim()) {
      setError("请输入邮箱验证码。");
      return;
    }

    setIsConfirmingVerification(true);
    setError("");
    setNotice("");
    try {
      const result = await confirmMyEmailVerification(
        token,
        verificationCode.trim(),
      );
      setOverview((current) =>
        current
          ? {
              ...current,
              emailVerifiedAt:
                result.emailVerifiedAt ?? new Date().toISOString(),
            }
          : current,
      );
      setVerificationCode("");
      setIsVerificationOpen(false);
      setNotice("邮箱验证完成。");
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : "邮箱验证失败。",
      );
    } finally {
      setIsConfirmingVerification(false);
    }
  }

  return (
    <section className="profile-panel account-security-panel">
      <div className="account-security-heading">
        <div>
          <span className="account-security-icon">
            <ShieldCheck aria-hidden="true" size={20} />
          </span>
          <div className="panel-heading">
            <span className="section-label">Account security</span>
            <strong>账号安全</strong>
          </div>
        </div>
        {overview ? (
          <span
            className={`email-verification-state ${overview.emailVerifiedAt ? "verified" : "pending"}`}
          >
            {overview.emailVerifiedAt ? (
              <MailCheck aria-hidden="true" size={15} />
            ) : (
              <MailWarning aria-hidden="true" size={15} />
            )}
            {overview.emailVerifiedAt ? "邮箱已验证" : "邮箱待验证"}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="account-security-empty">正在读取账号安全信息</p>
      ) : overview ? (
        <div className="account-security-content">
          <div className="security-preference-column">
            <div className="security-email-row">
              <div>
                <strong>{email}</strong>
                <span>
                  {overview.emailVerifiedAt
                    ? `验证于 ${formatDateTime(overview.emailVerifiedAt)}`
                    : "验证后可接收找回与风险邮件"}
                </span>
              </div>
              {!overview.emailVerifiedAt ? (
                <button
                  className="text-action primary"
                  disabled={isSendingVerification || retryAfter > 0}
                  onClick={() => void handleSendVerification()}
                  type="button"
                >
                  {isSendingVerification
                    ? "发送中"
                    : retryAfter > 0
                      ? `${retryAfter} 秒`
                      : "验证邮箱"}
                </button>
              ) : null}
            </div>

            {isVerificationOpen && !overview.emailVerifiedAt ? (
              <div className="security-verification-row">
                <input
                  aria-label="邮箱验证码"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  placeholder="输入验证码"
                  value={verificationCode}
                />
                <button
                  className="text-action primary"
                  disabled={isConfirmingVerification}
                  onClick={() => void handleConfirmVerification()}
                  type="button"
                >
                  {isConfirmingVerification ? "验证中" : "确认"}
                </button>
              </div>
            ) : null}

            <div className="security-preference-list">
              {preferenceOptions.map((option) => (
                <label key={option.key}>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <input
                    checked={overview.preferences[option.key]}
                    disabled={savingPreference !== null}
                    onChange={(event) =>
                      void handlePreferenceChange(option.key, event.target.checked)
                    }
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
          </div>

          <SecurityEvents events={overview.events} />
          <TrustedDevices devices={overview.trustedDevices} />
        </div>
      ) : (
        <p className="account-security-empty">暂时无法显示账号安全信息</p>
      )}

      <AppToast
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />
    </section>
  );
}

function SecurityEvents({ events }: { events: SecurityEvent[] }) {
  return (
    <div className="security-compact-list">
      <div className="security-list-heading">
        <ShieldAlert aria-hidden="true" size={16} />
        <strong>最近安全事件</strong>
      </div>
      {events.length ? (
        events.slice(0, 5).map((event) => (
          <div className="security-event-row" key={event.id}>
            <span className={`security-risk-dot ${event.riskLevel}`} />
            <div>
              <strong>{event.summary || securityEventLabel(event.type)}</strong>
              <small>
                {event.deviceLabel || "未知设备"} · {event.ip || "IP 未记录"}
              </small>
            </div>
            <time dateTime={event.createdAt}>
              {formatDateTime(event.createdAt)}
            </time>
          </div>
        ))
      ) : (
        <p className="account-security-empty compact">暂无安全事件</p>
      )}
    </div>
  );
}

function TrustedDevices({ devices }: { devices: TrustedDevice[] }) {
  return (
    <div className="security-compact-list">
      <div className="security-list-heading">
        <Laptop aria-hidden="true" size={16} />
        <strong>可信设备</strong>
      </div>
      {devices.length ? (
        devices.slice(0, 5).map((device) => (
          <div className="trusted-device-row" key={device.id}>
            <BadgeCheck aria-hidden="true" size={16} />
            <div>
              <strong>{device.deviceLabel || device.label || "已识别设备"}</strong>
              <small>{device.lastIp || device.ip || "IP 未记录"}</small>
            </div>
            <span>
              <Clock3 aria-hidden="true" size={12} />
              {formatDateTime(
                device.lastSeenAt || device.trustedAt || device.firstSeenAt || "",
              )}
            </span>
          </div>
        ))
      ) : (
        <p className="account-security-empty compact">暂无可信设备</p>
      )}
    </div>
  );
}

function securityEventLabel(type: string): string {
  const labels: Record<string, string> = {
    login: "账号登录",
    login_success: "登录成功",
    login_failed: "登录失败",
    new_device: "新设备登录",
    unfamiliar_ip: "陌生 IP 登录",
    password_changed: "密码已修改",
    password_reset: "密码已重置",
  };
  return (labels[type] ?? type) || "安全事件";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
