"use client";

/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AuthAppearance,
  AuthUser,
  getMe,
  resolveApiUrl,
  updateMyAppearance,
  updateMyProfile,
  uploadMyAvatar,
} from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  readAccessToken,
} from "@/lib/auth-storage";
import {
  defaultThemePreference,
  normalizeThemePreference,
  portalThemes,
  readThemePreference,
  RecommendedThemeId,
  ThemePreference,
  writeThemePreference,
} from "@/lib/theme-preferences";

type AppearanceColorKey =
  | "customAccent"
  | "customSurface"
  | "customForeground"
  | "customMuted"
  | "glassTint";

const AVATAR_MAX_FILE_SIZE = 2 * 1024 * 1024;

const roleIcons: Record<string, string> = {
  qi_refining: "气",
  foundation_building: "基",
  golden_core: "丹",
  nascent_soul: "婴",
  spirit_transformation: "神",
  void_refining: "虚",
  body_integration: "合",
  mahayana: "乘",
  administrator: "管",
};

const levelRoadmap = [
  { code: "qi_refining", name: "练气", level: 10, status: "注册自动获取" },
  { code: "foundation_building", name: "筑基", level: 20, status: "未开放" },
  { code: "golden_core", name: "金丹", level: 30, status: "未开放" },
  { code: "nascent_soul", name: "元婴", level: 40, status: "未开放" },
  { code: "spirit_transformation", name: "化神", level: 50, status: "未开放" },
  { code: "void_refining", name: "炼虚", level: 60, status: "未开放" },
  { code: "body_integration", name: "合体", level: 70, status: "未开放" },
  { code: "mahayana", name: "大乘", level: 80, status: "未开放" },
];

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isLevelInfoOpen, setIsLevelInfoOpen] = useState(false);
  const [profileBioDraft, setProfileBioDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    getMe(token)
      .then((currentUser) => {
        const accountPreference = normalizeThemePreference(currentUser.appearance);
        setUser(currentUser);
        setProfileBioDraft(currentUser.profileBio);
        setPreference(accountPreference);
        writeThemePreference(accountPreference);
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : "无法获取当前用户。",
        );
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const normalizedPreference = useMemo(
    () => normalizeThemePreference(preference),
    [preference],
  );

  const customAccent =
    normalizedPreference.customAccent ?? defaultThemePreference.customAccent!;
  const customSurface =
    normalizedPreference.customSurface ?? defaultThemePreference.customSurface!;
  const customForeground =
    normalizedPreference.customForeground ??
    defaultThemePreference.customForeground!;
  const customMuted =
    normalizedPreference.customMuted ?? defaultThemePreference.customMuted!;
  const cardAlpha =
    normalizedPreference.cardAlpha ?? defaultThemePreference.cardAlpha!;
  const glassBlur =
    normalizedPreference.glassBlur ?? defaultThemePreference.glassBlur!;
  const glassTint =
    normalizedPreference.glassTint ?? defaultThemePreference.glassTint!;
  const glassTintAlpha =
    normalizedPreference.glassTintAlpha ??
    defaultThemePreference.glassTintAlpha!;

  async function commitPreference(partialPreference: Partial<ThemePreference>) {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const nextPreference = normalizeThemePreference({
      ...normalizedPreference,
      ...partialPreference,
    });

    setPreference(nextPreference);
    writeThemePreference(nextPreference);
    setIsSavingAppearance(true);
    setError("");
    setNotice("");

    try {
      const updatedUser = await updateMyAppearance(token, toAppearancePayload(nextPreference));
      setUser(updatedUser);
      setNotice("外观设置已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "外观设置保存失败。");
    } finally {
      setIsSavingAppearance(false);
    }
  }

  function selectRecommendedTheme(themeId: RecommendedThemeId) {
    void commitPreference({ themeId });
  }

  function selectCustomTheme() {
    void commitPreference({ themeId: "custom" });
  }

  function updateAppearanceColor(key: AppearanceColorKey, value: string) {
    void commitPreference(
      key === "glassTint" ? { glassTint: value } : { [key]: value, themeId: "custom" },
    );
  }

  async function handleAvatarChange(file: File | undefined) {
    const token = readAccessToken();
    if (!token || !file) {
      if (!token) {
        router.replace("/login");
      }
      return;
    }

    if (file.size > AVATAR_MAX_FILE_SIZE) {
      setError("头像图片不能超过 2 MB。");
      setNotice("");
      return;
    }

    setIsUploadingAvatar(true);
    setError("");
    setNotice("");
    try {
      const updatedUser = await uploadMyAvatar(token, file);
      setUser(updatedUser);
      window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
      setNotice("头像已更新。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "头像上传失败。");
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const nextBio = profileBioDraft.trim();
    if (!nextBio) {
      setError("个人介绍不能为空。");
      setNotice("");
      return;
    }

    setIsSavingProfile(true);
    setError("");
    setNotice("");
    try {
      const updatedUser = await updateMyProfile(token, { profileBio: nextBio });
      setUser(updatedUser);
      setProfileBioDraft(updatedUser.profileBio);
      window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
      setNotice("个人介绍已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "个人介绍保存失败。");
    } finally {
      setIsSavingProfile(false);
    }
  }

  const roleIcon = user ? roleIcons[user.role.code] ?? "R" : "R";
  const avatarInitial = user?.username.trim().slice(0, 1).toUpperCase() ?? "H";
  const avatarUrl = user?.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  const joinedAt = user?.createdAt ? new Date(user.createdAt) : null;
  const joinedAtText = joinedAt ? formatJoinedAt(joinedAt) : "";
  const memberDurationText = joinedAt ? formatDuration(now - joinedAt.getTime()) : "";

  const previewStyle = {
    "--theme-preview-accent": customAccent,
    "--theme-preview-alpha": cardAlpha / 100,
    "--theme-preview-blur": `${glassBlur}px`,
    "--theme-preview-foreground": customForeground,
    "--theme-preview-glass": glassTint,
    "--theme-preview-glass-alpha": glassTintAlpha / 100,
    "--theme-preview-muted": customMuted,
    "--theme-preview-surface-rgb": hexToRgbString(customSurface),
  } as CSSProperties;

  const colorControls: Array<{
    key: AppearanceColorKey;
    label: string;
    value: string;
  }> = [
    { key: "customAccent", label: "强调色", value: customAccent },
    { key: "customSurface", label: "卡片底色", value: customSurface },
    { key: "customForeground", label: "主文字", value: customForeground },
    { key: "customMuted", label: "辅助文字", value: customMuted },
    { key: "glassTint", label: "磨砂颜色", value: glassTint },
  ];

  return (
    <section className="page-shell profile-page">
      <header className="page-header">
        <span className="eyebrow">HLOVET Account</span>
        <div className="title-row">
          <div>
            <h1>个人中心</h1>
          </div>
          <div className="actions">
            <Link className="text-action" href="/dashboard">
              返回空间
            </Link>
          </div>
        </div>
      </header>

      {isLoading || isSavingAppearance || isSavingProfile ? (
        <div className="status-row compact-status-row">
          {isLoading ? <span className="status">正在读取身份</span> : null}
          {isSavingAppearance ? <span className="status">外观保存中</span> : null}
          {isSavingProfile ? <span className="status">资料保存中</span> : null}
        </div>
      ) : null}
      {error ? <p className="message error">{error}</p> : null}
      {notice ? <p className="profile-toast">{notice}</p> : null}

      {user ? (
        <div className="profile-settings-grid">
          <section className="profile-panel account-card">
            <div className="account-profile-row account-profile-hero">
              <label className="avatar-uploader">
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={isUploadingAvatar}
                  onChange={(event) => void handleAvatarChange(event.target.files?.[0])}
                  type="file"
                />
                <span className="profile-avatar">
                  {avatarUrl ? (
                    <img alt={`${user.username} 的头像`} src={avatarUrl} />
                  ) : (
                    avatarInitial
                  )}
                </span>
                <span>{isUploadingAvatar ? "上传中" : "更换头像"}</span>
              </label>

              <div className="account-profile-copy">
                <strong>{user.username}</strong>
                <p>{user.email}</p>
                <div className="account-role-line">
                  <span
                    aria-label={`当前角色：${user.role.name}`}
                    className="role-glyph"
                    title={user.role.name}
                  >
                    {roleIcon}
                  </span>
                  <span>{user.role.name}</span>
                  <button
                    aria-expanded={isLevelInfoOpen}
                    className="level-help-trigger"
                    onClick={() => setIsLevelInfoOpen((current) => !current)}
                    type="button"
                  >
                    等级说明
                  </button>
                </div>
              </div>
            </div>

            <dl className="account-metrics">
              <div>
                <dt>来到 HLOVET</dt>
                <dd>{joinedAtText}</dd>
              </div>
              <div>
                <dt>相伴时长</dt>
                <dd>{memberDurationText}</dd>
              </div>
            </dl>

            <div className="account-bio-card">
              <span className="section-label">个人介绍</span>
              <p>{user.profileBio}</p>
            </div>

            {isLevelInfoOpen ? (
              <div className="level-popover" role="dialog" aria-label="账号等级说明">
                <div className="panel-heading">
                  <span className="section-label">账号等级</span>
                  <strong>角色说明</strong>
                </div>
                <div className="level-roadmap">
                  {levelRoadmap.map((role) => {
                    const isCurrent = user.role.code === role.code;
                    return (
                      <div className={isCurrent ? "current" : ""} key={role.code}>
                        <span className="level-icon">{roleIcons[role.code]}</span>
                        <span>
                          <strong>{role.name}</strong>
                          <small>Lv.{role.level}</small>
                        </span>
                        <em>{isCurrent ? "当前等级" : role.status}</em>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          <section className="profile-panel profile-bio-panel">
            <div className="panel-heading">
              <span className="section-label">Profile</span>
              <strong>个人介绍</strong>
            </div>
            <form className="profile-bio-form" onSubmit={handleProfileSubmit}>
              <textarea
                maxLength={180}
                onChange={(event) => setProfileBioDraft(event.target.value)}
                placeholder="写一句别人能看到的介绍。"
                value={profileBioDraft}
              />
              <div className="profile-bio-actions">
                <span>{profileBioDraft.trim().length}/180</span>
                <button disabled={isSavingProfile} type="submit">
                  {isSavingProfile ? "保存中" : "保存介绍"}
                </button>
              </div>
            </form>
          </section>

          <section className="profile-panel theme-panel">
            <div className="panel-heading">
              <span className="section-label">主题外观</span>
              <strong>外观设置</strong>
            </div>

            <div className="theme-grid">
              {portalThemes.map((theme) => {
                const isActive = normalizedPreference.themeId === theme.id;

                return (
                  <button
                    aria-pressed={isActive}
                    className={`theme-option ${isActive ? "active" : ""}`}
                    key={theme.id}
                    onClick={() => selectRecommendedTheme(theme.id)}
                    type="button"
                  >
                    <span className="theme-swatches" aria-hidden="true">
                      {theme.swatches.map((swatch) => (
                        <span key={swatch} style={{ background: swatch }} />
                      ))}
                    </span>
                    <span className="theme-option-copy">
                      <strong>{theme.name}</strong>
                      <span>{theme.description}</span>
                    </span>
                    {isActive ? <span className="theme-selected">当前</span> : null}
                  </button>
                );
              })}
              <button
                aria-pressed={normalizedPreference.themeId === "custom"}
                className={`theme-option custom-theme-option ${
                  normalizedPreference.themeId === "custom" ? "active" : ""
                }`}
                onClick={selectCustomTheme}
                type="button"
              >
                <span className="theme-swatches" aria-hidden="true">
                  {[customSurface, customForeground, customMuted, customAccent].map(
                    (swatch) => (
                      <span key={swatch} style={{ background: swatch }} />
                    ),
                  )}
                </span>
                <span className="theme-option-copy">
                  <strong>自定义配色</strong>
                  <span>使用下方颜色组合自己的主题。</span>
                </span>
                {normalizedPreference.themeId === "custom" ? (
                  <span className="theme-selected">当前</span>
                ) : null}
              </button>
            </div>

            <div className="appearance-settings-grid">
              <div className="theme-control-list">
                <label className="theme-control-row range-row">
                  <span>
                    <strong>卡片透明度</strong>
                    <small>{cardAlpha}%</small>
                  </span>
                  <input
                    aria-label="卡片透明度"
                    max={76}
                    min={38}
                    onChange={(event) =>
                      void commitPreference({ cardAlpha: Number(event.target.value) })
                    }
                    type="range"
                    value={cardAlpha}
                  />
                </label>

                <label className="theme-control-row range-row">
                  <span>
                    <strong>磨砂程度</strong>
                    <small>{glassBlur}px</small>
                  </span>
                  <input
                    aria-label="磨砂程度"
                    max={36}
                    min={0}
                    onChange={(event) =>
                      void commitPreference({ glassBlur: Number(event.target.value) })
                    }
                    type="range"
                    value={glassBlur}
                  />
                </label>

                <label className="theme-control-row range-row">
                  <span>
                    <strong>磨砂透明度</strong>
                    <small>{glassTintAlpha}%</small>
                  </span>
                  <input
                    aria-label="磨砂透明度"
                    max={100}
                    min={0}
                    onChange={(event) =>
                      void commitPreference({ glassTintAlpha: Number(event.target.value) })
                    }
                    type="range"
                    value={glassTintAlpha}
                  />
                </label>
              </div>

              <div className="theme-control-list color-control-list">
                {colorControls.map((control) => (
                  <label className="theme-control-row" key={control.key}>
                    <span>
                      <strong>{control.label}</strong>
                      <small>{control.value}</small>
                    </span>
                    <input
                      aria-label={control.label}
                      onChange={(event) =>
                        updateAppearanceColor(control.key, event.target.value)
                      }
                      type="color"
                      value={control.value}
                    />
                  </label>
                ))}
              </div>

              <div className="theme-preview" style={previewStyle}>
                <div className="theme-preview-scene" aria-hidden="true">
                  <div className="preview-mini-nav">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="preview-mini-hero">
                    <span />
                    <strong />
                  </div>
                  <div className="preview-mini-card" />
                  <div className="preview-mini-card small" />
                </div>
                <span>Preview</span>
                <strong>HLOVET</strong>
                <p>半透明玻璃会叠在背景上，磨砂颜色决定整体氛围。</p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function hexToRgbString(value: string): string {
  const hexValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value.slice(1) : "ffffff";
  return [0, 2, 4]
    .map((index) => Number.parseInt(hexValue.slice(index, index + 2), 16))
    .join(", ");
}

function formatJoinedAt(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${days}天 ${hours}小时 ${minutes}分 ${seconds}秒`;
}

function toAppearancePayload(preference: ThemePreference): AuthAppearance {
  const normalized = normalizeThemePreference(preference);

  return {
    cardAlpha: normalized.cardAlpha ?? defaultThemePreference.cardAlpha!,
    customAccent: normalized.customAccent ?? defaultThemePreference.customAccent!,
    customForeground:
      normalized.customForeground ?? defaultThemePreference.customForeground!,
    customMuted: normalized.customMuted ?? defaultThemePreference.customMuted!,
    customSurface:
      normalized.customSurface ?? defaultThemePreference.customSurface!,
    glassBlur: normalized.glassBlur ?? defaultThemePreference.glassBlur!,
    glassTint: normalized.glassTint ?? defaultThemePreference.glassTint!,
    glassTintAlpha:
      normalized.glassTintAlpha ?? defaultThemePreference.glassTintAlpha!,
    themeId: normalized.themeId,
  };
}
