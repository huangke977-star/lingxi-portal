"use client";

import {
  BadgeCheck,
  Laptop,
  MailCheck,
  MailWarning,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import {
  cancelTrustedDevice,
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

export function AccountSecurityPanel({ email }: AccountSecurityPanelProps) {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
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
  const [removingDeviceId, setRemovingDeviceId] = useState<
    string | number | null
  >(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const preferenceOptions: Array<{ key: keyof SecurityPreferences; label: string; description: string }> = [
    { key: "loginAlertsEnabled", label: phrase("登录提醒", "Login alerts"), description: phrase("记录并提醒账号登录动态", "Record and notify you of account sign-in activity") },
    { key: "emailAlertsEnabled", label: phrase("邮件提醒", "Email alerts"), description: phrase("将重要风险同步到邮箱", "Send important risk alerts to your email") },
    { key: "newDeviceAlertsEnabled", label: phrase("新设备提醒", "New device alerts"), description: phrase("首次出现的设备单独提醒", "Send a separate alert for first-seen devices") },
  ];

  const loadSecurity = useCallback(async () => {
    const token = readAccessToken();
    if (!token) return;

    setIsLoading(true);
    try {
      setOverview(await getMySecurity(token));
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : phrase("账号安全信息读取失败。", "Could not load account security information."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [locale, phrase, router]);

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
      setNotice(phrase("安全提醒设置已更新。", "Security alert settings updated."));
    } catch (saveError) {
      setOverview((current) =>
        current ? { ...current, preferences: previousPreferences } : current,
      );
      setError(
        saveError instanceof Error ? saveError.message : phrase("设置更新失败。", "Could not update settings."),
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
      setNotice(phrase("验证码已发送，请检查邮箱。", "Verification code sent. Check your email."));
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : phrase("验证码发送失败。", "Could not send verification code."),
      );
    } finally {
      setIsSendingVerification(false);
    }
  }

  async function handleConfirmVerification() {
    const token = readAccessToken();
    if (!token || !verificationCode.trim()) {
      setError(phrase("请输入邮箱验证码。", "Enter the email verification code."));
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
      setNotice(phrase("邮箱验证完成。", "Email verification complete."));
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : phrase("邮箱验证失败。", "Email verification failed."),
      );
    } finally {
      setIsConfirmingVerification(false);
    }
  }

  async function handleCancelTrust(device: TrustedDevice) {
    const token = readAccessToken();
    if (!token || removingDeviceId !== null) return;
    const label = device.deviceLabel || device.label || phrase("这台设备", "this device");
    if (
      !window.confirm(
        phrase(`确定取消信任 ${label} 吗？当前会话不会退出，下次登录需要邮箱验证。`, `Remove trust for ${label}? The current session remains signed in, and the next sign-in will require email verification.`),
      )
    ) {
      return;
    }

    setRemovingDeviceId(device.id);
    setError("");
    setNotice("");
    try {
      await cancelTrustedDevice(token, device.id);
      setOverview((current) =>
        current
          ? {
              ...current,
              trustedDevices: current.trustedDevices.filter(
                (item) => item.id !== device.id,
              ),
            }
          : current,
      );
      setNotice(phrase("已取消信任，下次登录将验证邮箱。", "Trust removed. Email verification will be required at the next sign-in."));
    } catch (removeError) {
      if (isAuthExpiredError(removeError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        removeError instanceof Error ? removeError.message : phrase("取消信任失败。", "Could not remove trusted status."),
      );
    } finally {
      setRemovingDeviceId(null);
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
            <span className="section-label">{phrase("账号安全", "Account security")}</span>
            <strong>{phrase("账号安全", "Account security")}</strong>
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
            {overview.emailVerifiedAt
              ? phrase("邮箱已验证", "Email verified")
              : overview.mailServiceEnabled
                ? phrase("邮箱待验证", "Email verification pending")
                : phrase("邮件服务已停用", "Email service disabled")}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="account-security-empty">{phrase("正在读取账号安全信息", "Loading account security information")}</p>
      ) : overview ? (
        <div className="account-security-content">
          <div className="security-preference-column">
            <div className="security-email-row">
              <div>
                <strong>{email}</strong>
                <span>
                  {!overview.mailServiceEnabled
                    ? phrase("邮件服务已停用，邮箱验证和邮件提醒暂不可用", "Email service is disabled, so email verification and alerts are unavailable")
                    : overview.emailVerifiedAt
                    ? phrase(`验证于 ${formatDateTime(overview.emailVerifiedAt, locale)}`, `Verified ${formatDateTime(overview.emailVerifiedAt, locale)}`)
                    : phrase("验证后可接收找回与风险邮件", "Verify your email to receive recovery and risk alerts")}
                </span>
              </div>
              {overview.mailServiceEnabled && !overview.emailVerifiedAt ? (
                <button
                  className="text-action primary"
                  disabled={isSendingVerification || retryAfter > 0}
                  onClick={() => void handleSendVerification()}
                  type="button"
                >
                  {isSendingVerification
                    ? phrase("发送中", "Sending")
                    : retryAfter > 0
                      ? phrase(`${retryAfter} 秒`, `${retryAfter} sec`)
                      : phrase("验证邮箱", "Verify email")}
                </button>
              ) : null}
            </div>

            {overview.mailServiceEnabled && isVerificationOpen && !overview.emailVerifiedAt ? (
              <div className="security-verification-row">
                <input
                  aria-label={phrase("邮箱验证码", "Email verification code")}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  placeholder={phrase("输入验证码", "Enter verification code")}
                  value={verificationCode}
                />
                <button
                  className="text-action primary"
                  disabled={isConfirmingVerification}
                  onClick={() => void handleConfirmVerification()}
                  type="button"
                >
                  {isConfirmingVerification ? phrase("验证中", "Verifying") : phrase("确认", "Confirm")}
                </button>
              </div>
            ) : null}

            <div className="security-preference-list">
              {preferenceOptions.map((option) => (
                <label key={option.key}>
                  <span>
                    <strong>{option.label}</strong>
                    <small>
                      {option.key === "emailAlertsEnabled" && !overview.mailServiceEnabled
                        ? phrase("邮件服务已停用", "Email service disabled")
                        : option.description}
                    </small>
                  </span>
                  <input
                    checked={overview.preferences[option.key]}
                    disabled={
                      savingPreference !== null ||
                      (option.key === "emailAlertsEnabled" && !overview.mailServiceEnabled)
                    }
                    onChange={(event) =>
                      void handlePreferenceChange(
                        option.key,
                        event.target.checked,
                      )
                    }
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
          </div>

          <SecurityEvents events={overview.events} />
          <TrustedDevices
            devices={overview.trustedDevices}
            onCancelTrust={handleCancelTrust}
            removingDeviceId={removingDeviceId}
          />
        </div>
      ) : (
        <p className="account-security-empty">{phrase("暂时无法显示账号安全信息", "Account security information is unavailable")}</p>
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
  const { locale, phrase } = useLanguage();
  return (
    <div className="security-compact-list">
      <div className="security-list-heading">
        <ShieldAlert aria-hidden="true" size={16} />
        <strong>{phrase("最近安全事件", "Recent security events")}</strong>
      </div>
      {events.length ? (
        events.slice(0, 5).map((event) => (
          <div className="security-event-row" key={event.id}>
            <span className={`security-risk-dot ${event.riskLevel}`} />
            <div>
              <strong>{event.summary || securityEventLabel(event.type, locale)}</strong>
              <small>
                {event.deviceLabel || phrase("未知设备", "Unknown device")} · {event.ip || phrase("IP 未记录", "IP not recorded")}
              </small>
            </div>
            <time dateTime={event.createdAt}>
              {formatDateTime(event.createdAt, locale)}
            </time>
          </div>
        ))
      ) : (
        <p className="account-security-empty compact">{phrase("暂无安全事件", "No security events")}</p>
      )}
    </div>
  );
}

function TrustedDevices({
  devices,
  onCancelTrust,
  removingDeviceId,
}: {
  devices: TrustedDevice[];
  onCancelTrust: (device: TrustedDevice) => void;
  removingDeviceId: string | number | null;
}) {
  const { locale, phrase } = useLanguage();
  return (
    <div className="security-compact-list">
      <div className="security-list-heading">
        <Laptop aria-hidden="true" size={16} />
        <strong>{phrase("信任设备", "Trusted devices")}</strong>
      </div>
      {devices.length ? (
        devices.slice(0, 5).map((device) => (
          <div className="trusted-device-row" key={device.id}>
            <BadgeCheck aria-hidden="true" size={16} />
            <div>
              <strong>
                {device.deviceLabel || device.label || phrase("已识别设备", "Recognized device")}
              </strong>
              <small>
                {device.lastIp || device.ip || phrase("IP 未记录", "IP not recorded")} · {phrase("信任于", "Trusted")} {formatDateTime(device.trustedAt || device.firstSeenAt || "", locale)}
              </small>
            </div>
            {device.current ? <em>{phrase("当前设备", "Current device")}</em> : null}
            <button
              aria-label={phrase(`取消信任 ${device.deviceLabel || device.label || "设备"}`, `Remove trust for ${device.deviceLabel || device.label || "device"}`)}
              className="trusted-device-remove"
              disabled={removingDeviceId !== null}
              onClick={() => onCancelTrust(device)}
              title={phrase("取消信任", "Remove trust")}
              type="button"
            >
              <ShieldOff aria-hidden="true" size={16} />
            </button>
          </div>
        ))
      ) : (
        <p className="account-security-empty compact">{phrase("暂无可信设备", "No trusted devices")}</p>
      )}
    </div>
  );
}

function securityEventLabel(type: string, locale: "zh-CN" | "en-US"): string {
  const labels: Record<string, readonly [string, string]> = {
    login: ["账号登录", "Account sign-in"],
    login_success: ["登录成功", "Sign-in successful"],
    login_failed: ["登录失败", "Sign-in failed"],
    new_device: ["新设备登录", "New device sign-in"],
    unfamiliar_ip: ["陌生 IP 登录", "Unfamiliar IP sign-in"],
    password_changed: ["密码已修改", "Password changed"],
    password_reset: ["密码已重置", "Password reset"],
  };
  const label = labels[type]?.[locale === "en-US" ? 1 : 0];
  return label || type || (locale === "en-US" ? "Security event" : "安全事件");
}

function formatDateTime(value: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return locale === "en-US" ? "Time not recorded" : "时间未记录";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
