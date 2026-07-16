"use client";

/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area } from "react-easy-crop";
import { AppToast } from "@/components/app-toast";
import { RoleSymbol } from "@/components/role-symbol";
import {
  AuthAppearance,
  AuthSession,
  AuthUser,
  getMe,
  isAuthExpiredError,
  listMySessions,
  resolveApiUrl,
  revokeAllSessions,
  revokeOtherSessions,
  updateMyAppearance,
  updateMyProfile,
  uploadMyAvatar,
} from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  clearAuthTokens,
  readAccessToken,
} from "@/lib/auth-storage";
import { getAccountMotto } from "@/lib/account-mottos";
import {
  getAvatarFallbackText,
  getUserDisplayName,
} from "@/lib/user-display";
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

type LevelPopoverPlacement = "left" | "right";

interface LevelPopoverPosition {
  placement: LevelPopoverPlacement;
  style: CSSProperties;
}

const AVATAR_SOURCE_MAX_FILE_SIZE = 20 * 1024 * 1024;
const AVATAR_UPLOAD_MAX_FILE_SIZE = 2 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 512;

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
  const levelHelpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const levelPopoverRef = useRef<HTMLDivElement | null>(null);
  const levelPopoverCloseTimerRef = useRef<number | null>(null);
  const [levelPopoverStyle, setLevelPopoverStyle] = useState<CSSProperties>({});
  const [levelPopoverPlacement, setLevelPopoverPlacement] = useState<LevelPopoverPlacement>("right");
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null);
  const [avatarCropFileName, setAvatarCropFileName] = useState("avatar");
  const [avatarCrop, setAvatarCrop] = useState({ x: 0, y: 0 });
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarCropPixels, setAvatarCropPixels] = useState<Area | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [profileBioDraft, setProfileBioDraft] = useState("");
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionAction, setSessionAction] = useState<
    "others" | "all" | null
  >(null);
  const [now, setNow] = useState(() => Date.now());
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );

  const loadAccountSessions = useCallback(
    async (token = readAccessToken()) => {
      if (!token) {
        setSessions([]);
        return;
      }
      setIsLoadingSessions(true);
      try {
        setSessions(await listMySessions(token));
      } catch (sessionError) {
        if (isAuthExpiredError(sessionError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "无法读取登录设备。",
        );
      } finally {
        setIsLoadingSessions(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    getMe(token)
      .then((currentUser) => {
        const accountPreference = normalizeThemePreference(
          currentUser.appearance,
        );
        setUser(currentUser);
        setNicknameDraft(currentUser.nickname);
        setEmailDraft(currentUser.email);
        setProfileBioDraft(currentUser.profileBio);
        setPreference(accountPreference);
        writeThemePreference(accountPreference);
        void loadAccountSessions(readAccessToken());
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }

        setError(
          loadError instanceof Error ? loadError.message : "无法获取当前用户。",
        );
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [loadAccountSessions, router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isLevelInfoOpen) {
      return;
    }

    function updatePosition() {
      if (levelHelpTriggerRef.current) {
        const position = calculateLevelPopoverPosition(
          levelHelpTriggerRef.current,
          levelPopoverRef.current?.offsetHeight,
        );
        setLevelPopoverStyle(position.style);
        setLevelPopoverPlacement(position.placement);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        levelHelpTriggerRef.current?.contains(target) ||
        levelPopoverRef.current?.contains(target)
      ) {
        return;
      }

      setIsLevelInfoOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsLevelInfoOpen(false);
      }
    }

    updatePosition();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isLevelInfoOpen]);

  useEffect(
    () => () => {
      if (levelPopoverCloseTimerRef.current !== null) {
        window.clearTimeout(levelPopoverCloseTimerRef.current);
      }
    },
    [],
  );

  useEffect(
    () => () => {
      if (avatarCropSource) {
        URL.revokeObjectURL(avatarCropSource);
      }
    },
    [avatarCropSource],
  );

  useEffect(() => {
    if (!avatarCropSource) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isUploadingAvatar) {
        setAvatarCropSource(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [avatarCropSource, isUploadingAvatar]);

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
      const updatedUser = await updateMyAppearance(
        token,
        toAppearancePayload(nextPreference),
      );
      setUser(updatedUser);
      setNotice("外观设置已保存。");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "外观设置保存失败。",
      );
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
      key === "glassTint"
        ? { glassTint: value }
        : { [key]: value, themeId: "custom" },
    );
  }

  function cancelLevelInfoClose() {
    if (levelPopoverCloseTimerRef.current !== null) {
      window.clearTimeout(levelPopoverCloseTimerRef.current);
      levelPopoverCloseTimerRef.current = null;
    }
  }

  function openLevelInfo() {
    cancelLevelInfoClose();
    if (levelHelpTriggerRef.current) {
      const position = calculateLevelPopoverPosition(
        levelHelpTriggerRef.current,
        levelPopoverRef.current?.offsetHeight,
      );
      setLevelPopoverStyle(position.style);
      setLevelPopoverPlacement(position.placement);
    }
    setIsLevelInfoOpen(true);
  }

  function scheduleLevelInfoClose() {
    cancelLevelInfoClose();
    levelPopoverCloseTimerRef.current = window.setTimeout(() => {
      setIsLevelInfoOpen(false);
      levelPopoverCloseTimerRef.current = null;
    }, 180);
  }

  async function handleAvatarChange(file: File | undefined) {
    const token = readAccessToken();
    if (!token || !file) {
      if (!token) {
        router.replace("/login");
      }
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("头像仅支持 JPEG、PNG 或 WebP 图片。");
      setNotice("");
      return;
    }

    if (file.size > AVATAR_SOURCE_MAX_FILE_SIZE) {
      setError("原始头像图片不能超过 20 MB。");
      setNotice("");
      return;
    }

    setError("");
    setNotice("");
    setIsLevelInfoOpen(false);
    setAvatarCrop({ x: 0, y: 0 });
    setAvatarZoom(1);
    setAvatarCropPixels(null);
    setAvatarCropFileName(file.name);
    setAvatarCropSource(URL.createObjectURL(file));
  }

  async function handleAvatarCropConfirm() {
    const token = readAccessToken();
    if (!token || !avatarCropSource || !avatarCropPixels) {
      if (!token) {
        router.replace("/login");
      }
      return;
    }

    setIsUploadingAvatar(true);
    setError("");
    setNotice("");
    try {
      const croppedFile = await createCroppedAvatarFile(
        avatarCropSource,
        avatarCropPixels,
        avatarCropFileName,
      );

      if (croppedFile.size > AVATAR_UPLOAD_MAX_FILE_SIZE) {
        throw new Error("裁剪后的头像超过 2 MB，请缩小图片后重试。");
      }

      const updatedUser = await uploadMyAvatar(token, croppedFile);
      setUser(updatedUser);
      setAvatarCropSource(null);
      window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
      setNotice("头像已更新。");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "头像上传失败。",
      );
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

    const nextNickname = nicknameDraft.trim();
    const nextEmail = emailDraft.trim().toLowerCase();
    const nextBio = profileBioDraft.trim();
    const nicknameLength = Array.from(nextNickname).length;

    if (!nextNickname) {
      setError("昵称不能为空。");
      setNotice("");
      return;
    }

    if (nicknameLength > 24 && nextNickname !== user?.nickname) {
      setError("昵称最多 24 个字符。");
      setNotice("");
      return;
    }

    if (!nextEmail) {
      setError("邮箱不能为空。");
      setNotice("");
      return;
    }

    if (!nextBio) {
      setError("个人介绍不能为空。");
      setNotice("");
      return;
    }

    setIsSavingProfile(true);
    setError("");
    setNotice("");
    try {
      const updatedUser = await updateMyProfile(token, {
        nickname: nextNickname,
        email: nextEmail,
        profileBio: nextBio,
      });
      setUser(updatedUser);
      setNicknameDraft(updatedUser.nickname);
      setEmailDraft(updatedUser.email);
      setProfileBioDraft(updatedUser.profileBio);
      window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
      setNotice("个人资料已保存。");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "个人资料保存失败。",
      );
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleRevokeOtherSessions() {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!window.confirm("确定退出其他设备吗？当前设备会保持登录。")) {
      return;
    }

    setSessionAction("others");
    setError("");
    setNotice("");
    try {
      const revoked = await revokeOtherSessions(token);
      await loadAccountSessions(readAccessToken());
      setNotice(`已退出 ${revoked} 个其他设备会话。`);
    } catch (sessionError) {
      if (isAuthExpiredError(sessionError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "退出其他设备失败。",
      );
    } finally {
      setSessionAction(null);
    }
  }

  async function handleRevokeAllSessions() {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!window.confirm("确定退出全部设备吗？当前页面也会退出登录。")) {
      return;
    }

    setSessionAction("all");
    setError("");
    setNotice("");
    try {
      await revokeAllSessions(token);
      clearAuthTokens();
      router.replace("/");
    } catch (sessionError) {
      if (isAuthExpiredError(sessionError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "退出全部设备失败。",
      );
      setSessionAction(null);
    }
  }

  const avatarInitial = user ? getAvatarFallbackText(user) : "H";
  const avatarUrl = user?.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  const joinedAt = user?.createdAt ? new Date(user.createdAt) : null;
  const joinedAtText = joinedAt ? formatJoinedAt(joinedAt) : "";
  const memberDurationText = joinedAt
    ? formatDuration(now - joinedAt.getTime())
    : "";
  const accountMotto = useMemo(
    () => (user ? getAccountMotto(user) : ""),
    [user],
  );
  const toastMessage = isSavingAppearance
    ? "外观保存中"
    : isSavingProfile
      ? "资料保存中"
      : sessionAction
        ? "会话处理中"
      : notice;

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
        </div>
      </header>

      {isLoading ? (
        <div className="status-row compact-status-row">
          <span className="status">正在读取身份</span>
        </div>
      ) : null}
      {user ? (
        <div className="profile-settings-grid">
          <section className="profile-panel account-card">
            <div className="account-profile-row account-profile-hero">
              <label
                aria-label={isUploadingAvatar ? "头像上传中" : "更换头像"}
                className="avatar-uploader"
                title={isUploadingAvatar ? "头像上传中" : "更换头像"}
              >
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={isUploadingAvatar}
                  onChange={(event) => {
                    void handleAvatarChange(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                  type="file"
                />
                <span className="profile-avatar">
                  {avatarUrl ? (
                    <img alt={`${getUserDisplayName(user)} 的头像`} src={avatarUrl} />
                  ) : (
                    avatarInitial
                  )}
                </span>
              </label>

              <div className="account-profile-copy">
                <div className="account-identity-copy">
                  <strong title={getUserDisplayName(user)}>{getUserDisplayName(user)}</strong>
                  <p title={`@${user.username}`}>@{user.username}</p>
                </div>
              </div>
            </div>

            <div className="account-role-tag">
              <span>{user.isSuperAdmin ? "超级管理员" : user.role.name}</span>
              <button
                aria-expanded={isLevelInfoOpen}
                aria-label="查看账号等级说明"
                className="level-help-trigger"
                onClick={openLevelInfo}
                onFocus={openLevelInfo}
                onPointerEnter={openLevelInfo}
                onPointerLeave={scheduleLevelInfoClose}
                ref={levelHelpTriggerRef}
                type="button"
              >
                ?
              </button>
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

            <blockquote className="account-motto">
              <span>给你的话</span>
              <p>{accountMotto}</p>
            </blockquote>
          </section>

          <section className="profile-panel profile-bio-panel">
            <div className="panel-heading profile-bio-heading">
              <span className="section-label">Personal profile</span>
              <strong>个人资料</strong>
            </div>
            <form className="profile-bio-form" onSubmit={handleProfileSubmit}>
              <div className="profile-field-grid">
                <label className="profile-field">
                  <span>昵称</span>
                  <input
                    aria-describedby="nickname-hint"
                    autoComplete="nickname"
                    onChange={(event) =>
                      setNicknameDraft(limitCharacterCount(event.target.value, 24))
                    }
                    placeholder="输入昵称"
                    required
                    value={nicknameDraft}
                  />
                  <small id="nickname-hint">
                    {Array.from(nicknameDraft.trim()).length}/24 · 用户名 @{user.username} 不会改变
                  </small>
                </label>
                <label className="profile-field">
                  <span>邮箱</span>
                  <input
                    autoComplete="email"
                    maxLength={191}
                    onChange={(event) => setEmailDraft(event.target.value)}
                    placeholder="输入邮箱"
                    required
                    type="email"
                    value={emailDraft}
                  />
                </label>
              </div>
              <label className="profile-field">
                <span>个人介绍</span>
                <textarea
                  maxLength={180}
                  onChange={(event) => setProfileBioDraft(event.target.value)}
                  placeholder="写一句别人能看到的介绍。"
                  required
                  value={profileBioDraft}
                />
              </label>
              <div className="profile-bio-actions">
                <span>{profileBioDraft.trim().length}/180</span>
                <button disabled={isSavingProfile} type="submit">
                  {isSavingProfile ? "保存中" : "保存资料"}
                </button>
              </div>
            </form>
          </section>

          <section className="profile-panel account-sessions-panel">
            <div className="account-sessions-heading">
              <div className="panel-heading">
                <span className="section-label">Login sessions</span>
                <strong>登录设备</strong>
              </div>
              <div className="account-session-actions">
                <button
                  className="text-action"
                  disabled={
                    sessionAction !== null ||
                    sessions.filter((session) => !session.current).length === 0
                  }
                  onClick={() => void handleRevokeOtherSessions()}
                  type="button"
                >
                  退出其他设备
                </button>
                <button
                  className="cache-danger-action"
                  disabled={sessionAction !== null || sessions.length === 0}
                  onClick={() => void handleRevokeAllSessions()}
                  type="button"
                >
                  退出全部设备
                </button>
              </div>
            </div>

            <div className="account-session-list">
              {isLoadingSessions ? (
                <p className="account-session-state">正在读取登录设备</p>
              ) : sessions.length ? (
                sessions.map((session) => (
                  <div className="account-session-row" key={session.id}>
                    <div>
                      <strong>{formatSessionDevice(session.userAgent)}</strong>
                      <span>{session.ip === "unknown" ? "IP 未记录" : session.ip}</span>
                    </div>
                    <div>
                      <span>登录时间</span>
                      <strong>{formatSessionTime(session.issuedAt)}</strong>
                    </div>
                    <div>
                      <span>有效期至</span>
                      <strong>{formatSessionTime(session.expiresAt)}</strong>
                    </div>
                    <em className={session.current ? "current" : ""}>
                      {session.current ? "当前设备" : "其他设备"}
                    </em>
                  </div>
                ))
              ) : (
                <p className="account-session-state">暂无可用登录会话</p>
              )}
            </div>
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
                    {isActive ? (
                      <span className="theme-selected">当前</span>
                    ) : null}
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
                  {[
                    customSurface,
                    customForeground,
                    customMuted,
                    customAccent,
                  ].map((swatch) => (
                    <span key={swatch} style={{ background: swatch }} />
                  ))}
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
                      void commitPreference({
                        cardAlpha: Number(event.target.value),
                      })
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
                      void commitPreference({
                        glassBlur: Number(event.target.value),
                      })
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
                      void commitPreference({
                        glassTintAlpha: Number(event.target.value),
                      })
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

      {user && isLevelInfoOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="账号等级说明"
              className="level-popover"
              data-placement={levelPopoverPlacement}
              onFocus={cancelLevelInfoClose}
              onPointerEnter={cancelLevelInfoClose}
              onPointerLeave={scheduleLevelInfoClose}
              ref={levelPopoverRef}
              role="dialog"
              style={levelPopoverStyle}
            >
              <div className="panel-heading level-popover-heading">
                <span className="section-label">账号等级</span>
                <strong>角色说明</strong>
              </div>
              <div className="level-roadmap">
                {levelRoadmap.map((role) => {
                  const isCurrent = user.role.code === role.code;
                  return (
                    <div
                      className={isCurrent ? "current" : ""}
                      key={role.code}
                    >
                      <span className="level-icon">
                        <RoleSymbol code={role.code} />
                      </span>
                      <span>
                        <strong>{role.name}</strong>
                        <small>Lv.{role.level}</small>
                      </span>
                      <em>{isCurrent ? "当前等级" : role.status}</em>
                    </div>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}

      <AppToast
        duration={error ? 4200 : 2600}
        message={error || toastMessage}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        persistent={
          !error &&
          (isSavingAppearance || isSavingProfile || sessionAction !== null)
        }
        tone={error ? "error" : toastMessage === notice ? "success" : "info"}
      />

      {avatarCropSource && typeof document !== "undefined"
        ? createPortal(
            <div
              className="avatar-crop-backdrop"
              onClick={() => {
                if (!isUploadingAvatar) {
                  setAvatarCropSource(null);
                }
              }}
              role="presentation"
            >
              <div
                aria-label="裁剪头像"
                aria-modal="true"
                className="avatar-crop-modal"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="avatar-crop-heading">
                  <div>
                    <span className="section-label">Avatar</span>
                    <strong>调整头像</strong>
                  </div>
                  <button
                    aria-label="取消裁剪头像"
                    className="level-modal-close"
                    disabled={isUploadingAvatar}
                    onClick={() => setAvatarCropSource(null)}
                    type="button"
                  >
                    ×
                  </button>
                </div>

                <div className="avatar-crop-stage">
                  <Cropper
                    aspect={1}
                    crop={avatarCrop}
                    cropShape="round"
                    image={avatarCropSource}
                    maxZoom={3}
                    minZoom={1}
                    onCropChange={setAvatarCrop}
                    onCropComplete={(_area, croppedAreaPixels) =>
                      setAvatarCropPixels(croppedAreaPixels)
                    }
                    onZoomChange={setAvatarZoom}
                    showGrid={false}
                    zoom={avatarZoom}
                  />
                </div>

                <label className="avatar-zoom-control">
                  <span>
                    <strong>缩放</strong>
                    <small>{Math.round(avatarZoom * 100)}%</small>
                  </span>
                  <input
                    aria-label="头像缩放"
                    max={3}
                    min={1}
                    onChange={(event) =>
                      setAvatarZoom(Number(event.target.value))
                    }
                    step={0.01}
                    type="range"
                    value={avatarZoom}
                  />
                </label>

                <div className="avatar-crop-actions">
                  <button
                    className="text-action"
                    disabled={isUploadingAvatar}
                    onClick={() => setAvatarCropSource(null)}
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    className="text-action primary"
                    disabled={isUploadingAvatar || !avatarCropPixels}
                    onClick={() => void handleAvatarCropConfirm()}
                    type="button"
                  >
                    {isUploadingAvatar ? "处理中" : "使用此头像"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

function calculateLevelPopoverPosition(trigger: HTMLElement, measuredHeight = 520): LevelPopoverPosition {
  const viewportPadding = 12;
  const gap = 8;
  const triggerRect = trigger.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - viewportPadding * 2);
  const triggerCenterX = triggerRect.left + triggerRect.width / 2;
  const triggerCenterY = triggerRect.top + triggerRect.height / 2;
  const hasSpaceOnRight = triggerRect.right + gap + width <= window.innerWidth - viewportPadding;
  const hasSpaceOnLeft = triggerRect.left - gap - width >= viewportPadding;
  let placement: LevelPopoverPlacement;
  let left: number;

  if (hasSpaceOnRight) {
    placement = "right";
    left = triggerRect.right + gap;
  } else if (hasSpaceOnLeft) {
    placement = "left";
    left = triggerRect.left - gap - width;
  } else if (triggerCenterX >= window.innerWidth / 2) {
    placement = "left";
    left = viewportPadding;
  } else {
    placement = "right";
    left = window.innerWidth - width - viewportPadding;
  }

  const top = Math.max(
    viewportPadding,
    Math.min(
      triggerRect.top - 24,
      window.innerHeight - measuredHeight - viewportPadding,
    ),
  );
  const arrowTop = Math.min(
    measuredHeight - 22,
    Math.max(12, triggerCenterY - top - 5),
  );

  return {
    placement,
    style: {
      left,
      top,
      width,
      "--level-popover-arrow-top": `${arrowTop}px`,
    } as CSSProperties,
  };
}

async function createCroppedAvatarFile(
  source: string,
  cropArea: Area,
  originalName: string,
): Promise<File> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("当前浏览器无法处理头像图片。");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    AVATAR_OUTPUT_SIZE,
    AVATAR_OUTPUT_SIZE,
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("头像裁剪失败，请重新选择图片。"));
        }
      },
      "image/webp",
      0.9,
    );
  });
  const baseName =
    originalName.replace(/\.[^.]+$/, "").slice(0, 80) || "avatar";

  return new File([blob], `${baseName}-avatar.webp`, {
    type: blob.type || "image/webp",
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取所选头像图片。"));
    image.src = source;
  });
}

function limitCharacterCount(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
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

function formatSessionTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSessionDevice(userAgent: string): string {
  if (!userAgent || userAgent === "unknown") {
    return "未知设备";
  }
  const device = /iPhone/i.test(userAgent)
    ? "iPhone"
    : /iPad/i.test(userAgent)
      ? "iPad"
      : /Android/i.test(userAgent)
        ? "Android"
        : /Windows/i.test(userAgent)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(userAgent)
            ? "Mac"
            : "其他设备";
  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /Chrome\//i.test(userAgent)
      ? "Chrome"
      : /Firefox\//i.test(userAgent)
        ? "Firefox"
        : /Safari\//i.test(userAgent)
          ? "Safari"
          : "浏览器";
  return `${device} · ${browser}`;
}

function toAppearancePayload(preference: ThemePreference): AuthAppearance {
  const normalized = normalizeThemePreference(preference);

  return {
    cardAlpha: normalized.cardAlpha ?? defaultThemePreference.cardAlpha!,
    customAccent:
      normalized.customAccent ?? defaultThemePreference.customAccent!,
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
