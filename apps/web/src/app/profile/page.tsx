"use client";

/* eslint-disable @next/next/no-img-element */

import type { ComponentType, CSSProperties, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area, type CropperProps } from "react-easy-crop";
import { BookOpen, Coins, Edit3, Eye, EyeOff, KeyRound, Link2, LogOut, MonitorSmartphone, Pin, Sparkles, TrendingUp, X } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { AccountSecurityPanel } from "@/components/account-security-panel";
import { GlassSelect } from "@/components/glass-select";
import { PasswordInput } from "@/components/password-input";
import { RoleSymbol } from "@/components/role-symbol";
import { AvatarManagementBadge } from "@/components/user-identity-badges";
import {
  AuthAppearance,
  AuthSession,
  AuthUser,
  ApiRequestError,
  changeMyPassword,
  getMe,
  isAuthExpiredError,
  listMySessions,
  resolveApiUrl,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
  updateMyAppearance,
  updateMyProfile,
  updateMyUsername,
  uploadMyAvatar,
} from "@/lib/auth-api";

import {
  AUTH_STATE_CHANGE_EVENT,
  clearAuthTokens,
  readAccessToken,
} from "@/lib/auth-storage";
import { getAccountMotto } from "@/lib/account-mottos";
import { localizedPath } from "@/lib/i18n";
import { getAvatarFallbackText, getUserDisplayName } from "@/lib/user-display";
import { getMyReputation, type ReputationSummary } from "@/lib/reputation-api";
import { reputationReasonLabel } from "@/lib/system-labels";
import { listMyArticles, type Article } from "@/lib/article-api";
import {
  getProfileSettings,
  listMyCollections,
  type ArticleCollection,
  type ProfileSettings,
  updateProfileSettings,
} from "@/lib/discovery-api";
import {
  defaultThemePreference,
  normalizeThemePreference,
  portalThemes,
  readThemePreference,
  RecommendedThemeId,
  ThemePreference,
  writeThemePreference,
} from "@/lib/theme-preferences";

type AvatarCropperProps = Pick<
  CropperProps,
  | "aspect"
  | "crop"
  | "cropShape"
  | "image"
  | "maxZoom"
  | "minZoom"
  | "onCropChange"
  | "onCropComplete"
  | "onZoomChange"
  | "showGrid"
  | "zoom"
>;

const AvatarCropper = Cropper as unknown as ComponentType<AvatarCropperProps>;

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
  { code: "qi_refining", name: "练气", level: 10, minExperience: 0 },
  { code: "foundation_building", name: "筑基", level: 20, minExperience: 200 },
  { code: "golden_core", name: "金丹", level: 30, minExperience: 500 },
  { code: "nascent_soul", name: "元婴", level: 40, minExperience: 1000 },
  { code: "spirit_transformation", name: "化神", level: 50, minExperience: 2000 },
  { code: "void_refining", name: "炼虚", level: 60, minExperience: 5000 },
  { code: "body_integration", name: "合体", level: 70, minExperience: 10000 },
  { code: "mahayana", name: "大乘", level: 80, minExperience: 20000 },
];

const defaultProfileSettings: ProfileSettings = {
  profileAccess: "public",
  searchable: true,
  friendRequestPolicy: "everyone",
  directMessagePolicy: "request",
  groupInvitationPolicy: "everyone",
  showBio: true,
  showJoinedAt: true,
  showStats: true,
  showFollowingCount: true,
  showPinnedContent: true,
  pinnedArticleId: null,
  pinnedCollectionId: null,
};

function levelName(code: string, locale: "zh-CN" | "en-US"): string {
  const names: Record<string, readonly [string, string]> = {
    qi_refining: ["练气", "Qi Refining"],
    foundation_building: ["筑基", "Foundation Building"],
    golden_core: ["金丹", "Golden Core"],
    nascent_soul: ["元婴", "Nascent Soul"],
    spirit_transformation: ["化神", "Spirit Transformation"],
    void_refining: ["炼虚", "Void Refining"],
    body_integration: ["合体", "Body Integration"],
    mahayana: ["大乘", "Mahayana"],
  };
  const name = names[code];
  return name ? name[locale === "en-US" ? 1 : 0] : code;
}

export default function ProfilePage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isLevelInfoOpen, setIsLevelInfoOpen] = useState(false);
  const levelHelpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const levelPopoverRef = useRef<HTMLDivElement | null>(null);
  const levelPopoverCloseTimerRef = useRef<number | null>(null);
  const [levelPopoverStyle, setLevelPopoverStyle] = useState<CSSProperties>({});
  const [levelPopoverPlacement, setLevelPopoverPlacement] =
    useState<LevelPopoverPlacement>("right");
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null);
  const [avatarCropFileName, setAvatarCropFileName] = useState("avatar");
  const [avatarCrop, setAvatarCrop] = useState({ x: 0, y: 0 });
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarCropPixels, setAvatarCropPixels] = useState<Area | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [profileBioDraft, setProfileBioDraft] = useState("");
  const [isUsernameDialogOpen, setIsUsernameDialogOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [profileSettings, setProfileSettings] = useState<ProfileSettings>(defaultProfileSettings);
  const [profileArticles, setProfileArticles] = useState<Article[]>([]);
  const [profileCollections, setProfileCollections] = useState<ArticleCollection[]>([]);
  const [reputation, setReputation] = useState<ReputationSummary | null>(null);
  const [isSavingProfileSettings, setIsSavingProfileSettings] = useState(false);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [sessionAction, setSessionAction] = useState<
    "others" | "all" | `session:${string}` | null
  >(null);
  const [now, setNow] = useState(() => Date.now());
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );
  const profileAccessOptions = useMemo(() => [
    { label: phrase("所有人", "Everyone"), value: "public" as const },
    { label: phrase("仅登录用户", "Signed-in users"), value: "authenticated" as const },
    { label: phrase("仅好友", "Friends only"), value: "friends" as const },
    { label: phrase("仅自己", "Only me"), value: "private" as const },
  ], [phrase]);
  const friendRequestOptions = useMemo(() => [
    { label: phrase("允许所有人申请", "Allow requests from everyone"), value: "everyone" as const },
    { label: phrase("不接收申请", "Do not accept requests"), value: "none" as const },
  ], [phrase]);
  const directMessageOptions = useMemo(() => [
    { label: phrase("所有人可直接私信", "Everyone can message directly"), value: "everyone" as const },
    { label: phrase("陌生人先进入请求箱", "Requests required for non-friends"), value: "request" as const },
    { label: phrase("仅好友可私信", "Friends only"), value: "friends" as const },
    { label: phrase("不接收私信", "Do not accept messages"), value: "none" as const },
  ], [phrase]);
  const groupInvitationOptions = useMemo(() => [
    { label: phrase("允许所有人邀请", "Allow invitations from everyone"), value: "everyone" as const },
    { label: phrase("仅好友可邀请", "Friends only"), value: "friends" as const },
    { label: phrase("不接收邀请", "Do not accept invitations"), value: "none" as const },
  ], [phrase]);
  const featuredArticleOptions = useMemo(() => [
    { label: phrase("暂不设置", "Not set"), value: "0" },
    ...profileArticles.map((article) => ({ label: article.title, value: String(article.id) })),
  ], [phrase, profileArticles]);
  const featuredCollectionOptions = useMemo(() => [
    { label: phrase("暂不设置", "Not set"), value: "0" },
    ...profileCollections.map((collection) => ({ label: collection.name, value: String(collection.id) })),
  ], [phrase, profileCollections]);
  const localizedLevelRoadmap = useMemo(() => levelRoadmap.map((item) => ({
    ...item,
    name: levelName(item.code, locale),
  })), [locale]);

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
          router.replace(localizedPath("/", locale));
          return;
        }
        setError(
          sessionError instanceof Error
            ? sessionError.message
          : phrase("无法读取登录设备。", "Could not load signed-in devices."),
        );
      } finally {
        setIsLoadingSessions(false);
      }
    },
    [locale, phrase, router],
  );

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
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
        setUsernameDraft(currentUser.username);
        setPreference(accountPreference);
        writeThemePreference(accountPreference);
        void loadAccountSessions(readAccessToken());
        void Promise.all([
          getProfileSettings(token),
          listMyArticles(token, { page: 1, pageSize: 50, status: "published", sort: "latest" }),
          listMyCollections(token),
          getMyReputation(token),
        ]).then(([settings, articleResult, collectionResult, reputationResult]) => {
          setProfileSettings(settings);
          setProfileArticles(articleResult.items);
          setProfileCollections(collectionResult.items);
          setReputation(reputationResult);
        }).catch((profileSettingsError) => {
          setError(profileSettingsError instanceof Error ? profileSettingsError.message : phrase("主页展示设置加载失败。", "Could not load public-profile settings."));
        });
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }

        setError(
          loadError instanceof Error ? loadError.message : phrase("无法获取当前用户。", "Could not load the current user."),
        );
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [loadAccountSessions, locale, phrase, router]);

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
      router.replace(localizedPath("/login", locale));
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
      setNotice(phrase("外观设置已保存。", "Appearance settings saved."));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : phrase("外观设置保存失败。", "Could not save appearance settings."),
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
        router.replace(localizedPath("/login", locale));
      }
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(phrase("头像仅支持 JPEG、PNG 或 WebP 图片。", "Only JPEG, PNG, or WebP images can be used for an avatar."));
      setNotice("");
      return;
    }

    if (file.size > AVATAR_SOURCE_MAX_FILE_SIZE) {
      setError(phrase("原始头像图片不能超过 20 MB。", "The source avatar image cannot exceed 20 MB."));
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
        router.replace(localizedPath("/login", locale));
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
        phrase,
      );

      if (croppedFile.size > AVATAR_UPLOAD_MAX_FILE_SIZE) {
        throw new Error(phrase("裁剪后的头像超过 2 MB，请缩小图片后重试。", "The cropped avatar exceeds 2 MB. Choose a smaller image and try again."));
      }

      const updatedUser = await uploadMyAvatar(token, croppedFile);
      setUser(updatedUser);
      setAvatarCropSource(null);
      window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
      setNotice(phrase("头像已更新。", "Avatar updated."));
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : phrase("头像上传失败。", "Could not upload avatar."),
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }

    const nextNickname = nicknameDraft.trim();
    const nextEmail = emailDraft.trim().toLowerCase();
    const nextBio = profileBioDraft.trim();
    const nicknameLength = Array.from(nextNickname).length;

    if (!nextNickname) {
      setError(phrase("昵称不能为空。", "Nickname is required."));
      setNotice("");
      return;
    }

    if (nicknameLength > 24 && nextNickname !== user?.nickname) {
      setError(phrase("昵称最多 24 个字符。", "Nickname can contain at most 24 characters."));
      setNotice("");
      return;
    }

    if (!nextEmail) {
      setError(phrase("邮箱不能为空。", "Email is required."));
      setNotice("");
      return;
    }

    if (!nextBio) {
      setError(phrase("个人介绍不能为空。", "Bio is required."));
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
      setNotice(phrase("个人资料已保存。", "Profile saved."));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : phrase("个人资料保存失败。", "Could not save profile."),
      );
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleUsernameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !usernameDraft.trim()) return;
    setIsSavingUsername(true);
    setError("");
    try {
      const updated = await updateMyUsername(token, usernameDraft);
      setUser(updated);
      setUsernameDraft(updated.username);
      setIsUsernameDialogOpen(false);
      window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
      setNotice(phrase("用户名已更新。", "Username updated."));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : phrase("用户名更新失败。", "Could not update username."));
    } finally {
      setIsSavingUsername(false);
    }
  }

  async function commitProfileSettings(patch: Partial<ProfileSettings>) {
    const token = readAccessToken();
    if (!token || isSavingProfileSettings) return;
    const previous = profileSettings;
    setProfileSettings((current) => ({ ...current, ...patch }));
    setIsSavingProfileSettings(true);
    try {
      const updated = await updateProfileSettings(token, patch);
      setProfileSettings(updated);
      setNotice(phrase("主页展示设置已更新。", "Public-profile settings updated."));
    } catch (saveError) {
      setProfileSettings(previous);
      setError(saveError instanceof Error ? saveError.message : phrase("主页展示设置保存失败。", "Could not save public-profile settings."));
    } finally {
      setIsSavingProfileSettings(false);
    }
  }

  function openPasswordDialog() {
    setCurrentPassword("");
    setNewPassword("");
    setPasswordConfirmation("");
    setError("");
    setNotice("");
    setIsPasswordDialogOpen(true);
  }

  function closePasswordDialog() {
    if (isChangingPassword) return;
    setIsPasswordDialogOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setPasswordConfirmation("");
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    if (!currentPassword) {
      setError(phrase("请输入当前密码。", "Enter your current password."));
      return;
    }
    if (newPassword.length < 8) {
      setError(phrase("新密码至少需要 8 位。", "New password must be at least 8 characters."));
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setError(phrase("两次输入的新密码不一致。", "The new passwords do not match."));
      return;
    }

    setIsChangingPassword(true);
    setError("");
    setNotice("");
    try {
      const result = await changeMyPassword(token, {
        currentPassword,
        newPassword,
      });
      setIsPasswordDialogOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirmation("");
      await loadAccountSessions(readAccessToken());
      setNotice(
        result.revokedSessions
          ? phrase(`密码已更新，并退出了 ${result.revokedSessions} 个其他设备会话。`, `Password updated and ${result.revokedSessions} other device session(s) were signed out.`)
          : phrase("密码已更新。", "Password updated."),
      );
    } catch (passwordError) {
      if (isAuthExpiredError(passwordError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      const message =
        passwordError instanceof ApiRequestError
          ? passwordError.message === "Current password is incorrect."
            ? phrase("当前密码不正确。", "Current password is incorrect.")
            : passwordError.message === "New password must be different."
              ? phrase("新密码不能与当前密码相同。", "New password cannot match the current password.")
              : passwordError.message
          : passwordError instanceof Error
            ? passwordError.message
            : phrase("密码修改失败。", "Could not change password.");
      setError(message);
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function handleRevokeOtherSessions() {
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    if (!(await confirm(phrase("确定退出其他设备吗？当前设备会保持登录。", "Sign out other devices? This device will remain signed in.")))) {
      return;
    }

    setSessionAction("others");
    setError("");
    setNotice("");
    try {
      const revoked = await revokeOtherSessions(token);
      await loadAccountSessions(readAccessToken());
      setNotice(phrase(`已退出 ${revoked} 个其他设备会话。`, `${revoked} other device session(s) signed out.`));
    } catch (sessionError) {
      if (isAuthExpiredError(sessionError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : phrase("退出其他设备失败。", "Could not sign out other devices."),
      );
    } finally {
      setSessionAction(null);
    }
  }

  async function handleRevokeAllSessions() {
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    if (!(await confirm(phrase("确定退出全部设备吗？当前页面也会退出登录。", "Sign out all devices? This page will sign out too.")))) {
      return;
    }

    setSessionAction("all");
    setError("");
    setNotice("");
    try {
      await revokeAllSessions(token);
      clearAuthTokens();
      router.replace(localizedPath("/", locale));
    } catch (sessionError) {
      if (isAuthExpiredError(sessionError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : phrase("退出全部设备失败。", "Could not sign out all devices."),
      );
      setSessionAction(null);
    }
  }

  async function handleRevokeSession(session: AuthSession) {
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    const prompt = session.current
      ? phrase("确定退出当前设备吗？", "Sign out this device?")
      : phrase(`确定退出 ${formatSessionDevice(session.userAgent, locale)} 吗？`, `Sign out ${formatSessionDevice(session.userAgent, locale)}?`);
    if (!(await confirm(prompt))) return;

    setSessionAction(`session:${session.id}`);
    setError("");
    setNotice("");
    try {
      const result = await revokeSession(token, session.id);
      if (result.current) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      await loadAccountSessions(readAccessToken());
      setNotice(phrase("设备已退出。", "Device signed out."));
    } catch (sessionError) {
      if (isAuthExpiredError(sessionError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(
        sessionError instanceof Error ? sessionError.message : phrase("退出设备失败。", "Could not sign out device."),
      );
    } finally {
      setSessionAction(null);
    }
  }

  function handleSessionPanelToggle() {
    const willOpen = !isSessionsOpen;
    setIsSessionsOpen(willOpen);
    if (willOpen) {
      void loadAccountSessions();
    }
  }

  const avatarInitial = user ? getAvatarFallbackText(user) : "H";
  const avatarUrl = user?.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  const currentSession = sessions.find((session) => session.current) ?? null;
  const joinedAt = user?.createdAt ? new Date(user.createdAt) : null;
  const joinedAtText = joinedAt ? formatJoinedAt(joinedAt, locale) : "";
  const memberDurationText = joinedAt
    ? formatDuration(now - joinedAt.getTime(), locale)
    : "";
  const accountMotto = useMemo(
    () => (user ? getAccountMotto(user, locale) : ""),
    [locale, user],
  );
  const toastMessage = isSavingAppearance
    ? phrase("外观保存中", "Saving appearance")
    : isSavingProfile
      ? phrase("资料保存中", "Saving profile")
      : sessionAction
        ? phrase("会话处理中", "Updating session")
        : isChangingPassword
          ? phrase("密码保存中", "Saving password")
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
    { key: "customAccent", label: phrase("强调色", "Accent color"), value: customAccent },
    { key: "customSurface", label: phrase("卡片底色", "Card background"), value: customSurface },
    { key: "customForeground", label: phrase("主文字", "Primary text"), value: customForeground },
    { key: "customMuted", label: phrase("辅助文字", "Muted text"), value: customMuted },
    { key: "glassTint", label: phrase("磨砂颜色", "Glass tint"), value: glassTint },
  ];

  return (
    <section className="page-shell profile-page">
      {isLoading ? (
        <div className="status-row compact-status-row">
          <span className="status">{phrase("正在读取身份", "Loading account")}</span>
        </div>
      ) : null}
      {user ? (
        <div className="profile-settings-grid">
          <section className="profile-panel account-card">
            <div className="account-profile-row account-profile-hero">
              <label
                aria-label={isUploadingAvatar ? phrase("头像上传中", "Uploading avatar") : phrase("更换头像", "Change avatar")}
                className="avatar-uploader"
                title={isUploadingAvatar ? phrase("头像上传中", "Uploading avatar") : phrase("更换头像", "Change avatar")}
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
                <span className="profile-avatar identity-avatar-host">
                  <span className="identity-avatar-visual">
                    {avatarUrl ? (
                      <img
                        alt={phrase(`${getUserDisplayName(user)} 的头像`, `${getUserDisplayName(user)}'s avatar`)}
                        src={avatarUrl}
                      />
                    ) : (
                      avatarInitial
                    )}
                  </span>
                  <AvatarManagementBadge user={user} />
                </span>
              </label>

              <div className="account-profile-copy">
                <div className="account-identity-copy">
                  <strong title={getUserDisplayName(user)}>
                    {getUserDisplayName(user)}
                  </strong>
                  <p title={`@${user.username}`}>@{user.username}<button aria-label={phrase("修改用户名", "Edit username")} className="profile-username-edit" onClick={() => { setUsernameDraft(user.username); setIsUsernameDialogOpen(true); }} title={phrase("修改用户名", "Edit username")} type="button"><Edit3 aria-hidden="true" size={13} /></button></p>
                </div>
              </div>
            </div>

            <div className="account-role-tag">
              <span><RoleSymbol code={user.role.code} />{levelName(user.role.code, locale)}</span>
              <button
                aria-expanded={isLevelInfoOpen}
                aria-label={phrase("查看账号等级说明", "View account level guide")}
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
                <dt>{phrase("来到 HLOVET", "Joined HLOVET")}</dt>
                <dd>{joinedAtText}</dd>
              </div>
              <div>
                <dt>{phrase("相伴时长", "Time with HLOVET")}</dt>
                <dd>{memberDurationText}</dd>
              </div>
            </dl>

            <blockquote className="account-motto">
              <span>{phrase("给你的话", "A note for you")}</span>
              <p>{accountMotto}</p>
            </blockquote>

            <div className="current-session-summary">
              <div className="current-session-copy">
                <span>{phrase("当前登录设备", "Current signed-in device")}</span>
                <strong>
                  {isLoadingSessions && !currentSession
                    ? phrase("正在识别设备", "Identifying device")
                    : currentSession
                      ? formatSessionDevice(currentSession.userAgent, locale)
                      : phrase("未知设备", "Unknown device")}
                </strong>
                <small>
                  {currentSession?.ip && currentSession.ip !== "unknown"
                    ? currentSession.ip
                    : phrase("IP 未记录", "IP not recorded")}
                </small>
              </div>
              <button
                aria-controls="account-sessions-panel"
                aria-expanded={isSessionsOpen}
                aria-label={
                  isSessionsOpen ? phrase("收起登录设备列表", "Collapse signed-in device list") : phrase("展开登录设备列表", "Expand signed-in device list")
                }
                className={`session-panel-toggle ${isSessionsOpen ? "active" : ""}`}
                onClick={handleSessionPanelToggle}
                title={isSessionsOpen ? phrase("收起登录设备", "Collapse devices") : phrase("查看登录设备", "View devices")}
                type="button"
              >
                <MonitorSmartphone aria-hidden="true" strokeWidth={1.8} />
              </button>
            </div>
            <Link className="profile-integrations-link" href={localizedPath("/profile/integrations", locale)}>
              <Link2 aria-hidden="true" size={15} />
              {phrase("外部集成", "External integrations")}
            </Link>
          </section>

          <section className="profile-panel profile-bio-panel">
            <div className="panel-heading profile-bio-heading">
              <span className="section-label">{phrase("个人资料", "Personal profile")}</span>
              <strong>{phrase("个人资料", "Personal profile")}</strong>
              <button
                aria-label={phrase("修改密码", "Change password")}
                className="profile-password-trigger"
                onClick={openPasswordDialog}
                title={phrase("修改密码", "Change password")}
                type="button"
              >
                <KeyRound aria-hidden="true" size={19} />
              </button>
            </div>
            <form className="profile-bio-form" onSubmit={handleProfileSubmit}>
              <div className="profile-field-grid">
                <label className="profile-field">
                  <span>{phrase("昵称", "Nickname")}</span>
                  <input
                    aria-describedby="nickname-hint"
                    autoComplete="nickname"
                    onChange={(event) =>
                      setNicknameDraft(
                        limitCharacterCount(event.target.value, 24),
                      )
                    }
                    placeholder={phrase("输入昵称", "Enter nickname")}
                    required
                    value={nicknameDraft}
                  />
                  <small id="nickname-hint">
                    {phrase(`${Array.from(nicknameDraft.trim()).length}/24 · 用户名 @${user.username} 不会改变`, `${Array.from(nicknameDraft.trim()).length}/24 · Username @${user.username} cannot be changed`)}
                  </small>
                </label>
                <label className="profile-field">
                  <span>{phrase("邮箱", "Email")}</span>
                  <input
                    autoComplete="email"
                    maxLength={191}
                    onChange={(event) => setEmailDraft(event.target.value)}
                    placeholder={phrase("输入邮箱", "Enter email")}
                    required
                    type="email"
                    value={emailDraft}
                  />
                </label>
              </div>
              <label className="profile-field">
                <span>{phrase("个人介绍", "Bio")}</span>
                <textarea
                  maxLength={180}
                  onChange={(event) => setProfileBioDraft(event.target.value)}
                  placeholder={phrase("写一句别人能看到的介绍。", "Write a short introduction that others can see.")}
                  required
                  value={profileBioDraft}
                />
              </label>
              <div className="profile-bio-actions">
                <span>{profileBioDraft.trim().length}/180</span>
                <button disabled={isSavingProfile} type="submit">
                  {isSavingProfile ? phrase("保存中", "Saving") : phrase("保存资料", "Save profile")}
                </button>
              </div>
            </form>
          </section>

          {isSessionsOpen ? (
            <section
              className="profile-panel account-sessions-panel"
              id="account-sessions-panel"
            >
              <div className="account-sessions-heading">
                <div className="panel-heading">
                  <span className="section-label">Login sessions</span>
                  <strong>{phrase("登录设备", "Signed-in devices")}</strong>
                </div>
                <div className="account-session-actions">
                  <button
                    className="text-action"
                    disabled={
                      sessionAction !== null ||
                      sessions.filter((session) => !session.current).length ===
                        0
                    }
                    onClick={() => void handleRevokeOtherSessions()}
                    type="button"
                  >
                    {phrase("退出其他设备", "Sign out other devices")}
                  </button>
                  <button
                    className="cache-danger-action"
                    disabled={sessionAction !== null || sessions.length === 0}
                    onClick={() => void handleRevokeAllSessions()}
                    type="button"
                  >
                    {phrase("退出全部设备", "Sign out all devices")}
                  </button>
                </div>
              </div>

              <div className="account-session-list">
                {isLoadingSessions ? (
                  <p className="account-session-state">{phrase("正在读取登录设备", "Loading signed-in devices")}</p>
                ) : sessions.length ? (
                  sessions.map((session) => (
                    <div className="account-session-row" key={session.id}>
                      <div>
                        <strong>{formatSessionDevice(session.userAgent, locale)}</strong>
                        <span>{session.ip === "unknown" ? phrase("IP 未记录", "IP not recorded") : session.ip}</span>
                      </div>
                      <div>
                        <span>{phrase("登录时间", "Signed in")}</span>
                        <strong>{formatSessionTime(session.issuedAt, locale)}</strong>
                      </div>
                      <div>
                        <span>{phrase("有效期至", "Expires")}</span>
                        <strong>{formatSessionTime(session.expiresAt, locale)}</strong>
                      </div>
                      <em className={session.current ? "current" : ""}>
                        {session.current ? phrase("当前设备", "Current device") : phrase("其他设备", "Other device")}
                      </em>
                      <button
                        aria-label={phrase(`退出 ${formatSessionDevice(session.userAgent, locale)}`, `Sign out ${formatSessionDevice(session.userAgent, locale)}`)}
                        className="account-session-revoke"
                        disabled={sessionAction !== null}
                        onClick={() => void handleRevokeSession(session)}
                        title={phrase("退出设备", "Sign out device")}
                        type="button"
                      >
                        <LogOut aria-hidden="true" size={17} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="account-session-state">{phrase("暂无可用登录会话", "No active sign-in sessions")}</p>
                )}
              </div>
            </section>
          ) : null}

          <section className="profile-panel reputation-panel">
            <div className="panel-heading reputation-heading">
              <span className="section-label">Growth & points</span>
              <strong>{phrase("成长与积分", "Growth and points")}</strong><button className="text-action reputation-detail-link" onClick={() => router.push(localizedPath("/profile/points", locale))} type="button">{phrase("积分明细", "Point details")}</button>
            </div>
            {reputation ? <div className="reputation-layout">
              <div className="reputation-overview">
                <div className="reputation-level-summary">
                  <span className="reputation-symbol"><RoleSymbol code={reputation.level.code} /></span>
                  <div><span>{phrase("成长等级", "Growth level")}</span><strong>{levelName(reputation.level.code, locale)} <small>Lv.{reputation.level.level}</small></strong><p>{reputation.nextLevel ? phrase(`距离 ${reputation.nextLevel.name} 还需 ${reputation.experienceToNext} 经验`, `${reputation.experienceToNext} experience to ${levelName(reputation.nextLevel.code, locale)}`) : phrase("已达到当前最高成长等级", "You have reached the current maximum growth level")}</p></div>
                </div>
                <div className="reputation-progress" aria-label={phrase(`经验进度 ${reputation.progressPercent}%`, `Experience progress ${reputation.progressPercent}%`)}><span style={{ width: `${reputation.progressPercent}%` }} /></div>
                <div className="reputation-balances"><span><TrendingUp aria-hidden="true" size={17} /><small>{phrase("经验", "Experience")}</small><strong>{reputation.experience}</strong></span><span><Coins aria-hidden="true" size={17} /><small>{phrase("积分", "Points")}</small><strong>{reputation.points}</strong></span></div>
              </div>
              <div className="reputation-rules">
                <strong>{phrase("获取规则", "Earning rules")}</strong>
                {reputation.rules.map((rule) => <div key={rule.reason}><span>{reputationReasonLabel(rule.reason, locale, rule.label)}</span><em>{rule.experience ? phrase(`+${rule.experience} 经验`, `+${rule.experience} XP`) : ""}{rule.experience && rule.points ? " · " : ""}{rule.points ? phrase(`+${rule.points} 积分`, `+${rule.points} points`) : ""}</em>{rule.dailyExperienceCap ? <small>{phrase(`每日经验上限 ${rule.dailyExperienceCap}`, `Daily XP cap ${rule.dailyExperienceCap}`)}</small> : null}</div>)}
              </div>
              <div className="reputation-ledger">
                <strong>{phrase("最近记录", "Recent activity")}</strong>
                {reputation.recent.length ? reputation.recent.slice(0, 6).map((item) => <div key={item.id}><span><b>{reputationReasonLabel(item.reason, locale, item.description)}</b><small>{formatReputationTime(item.createdAt, locale)}</small></span><em>{item.experienceDelta ? phrase(`${item.experienceDelta > 0 ? "+" : ""}${item.experienceDelta} 经验`, `${item.experienceDelta > 0 ? "+" : ""}${item.experienceDelta} XP`) : ""}{item.experienceDelta && item.pointDelta ? " · " : ""}{item.pointDelta ? phrase(`${item.pointDelta > 0 ? "+" : ""}${item.pointDelta} 积分`, `${item.pointDelta > 0 ? "+" : ""}${item.pointDelta} points`) : ""}</em></div>) : <p>{phrase("完成阅读、评论或创作后，这里会显示记录。", "Records appear here after you read, comment, or publish.")}</p>}
              </div>
            </div> : <div className="reputation-empty"><Sparkles aria-hidden="true" size={18} />{phrase("正在读取成长记录", "Loading growth activity")}</div>}
          </section>

          <AccountSecurityPanel email={user.email} />

          <section className="profile-panel profile-display-panel">
            <div className="panel-heading profile-display-heading">
              <span className="section-label">Public profile</span>
              <strong>{phrase("主页展示", "Public profile")}</strong>
              <span>{isSavingProfileSettings ? phrase("正在同步", "Syncing") : phrase("账号级保存", "Saved to your account")}</span>
            </div>
            <div className="profile-policy-grid">
              <label>
                <span>{phrase("主页可见范围", "Profile visibility")}</span>
                <GlassSelect ariaLabel={phrase("主页可见范围", "Profile visibility")} disabled={isSavingProfileSettings} onChange={(profileAccess) => void commitProfileSettings({ profileAccess })} options={profileAccessOptions} value={profileSettings.profileAccess} />
              </label>
              <label>
                <span>{phrase("好友申请", "Friend requests")}</span>
                <GlassSelect ariaLabel={phrase("好友申请接收范围", "Friend request policy")} disabled={isSavingProfileSettings} onChange={(friendRequestPolicy) => void commitProfileSettings({ friendRequestPolicy })} options={friendRequestOptions} value={profileSettings.friendRequestPolicy} />
              </label>
              <label>
                <span>{phrase("陌生私信", "Direct messages")}</span>
                <GlassSelect ariaLabel={phrase("私信接收范围", "Direct message policy")} disabled={isSavingProfileSettings} onChange={(directMessagePolicy) => void commitProfileSettings({ directMessagePolicy })} options={directMessageOptions} value={profileSettings.directMessagePolicy} />
              </label>
              <label>
                <span>{phrase("群聊邀请", "Group invitations")}</span>
                <GlassSelect ariaLabel={phrase("群聊邀请接收范围", "Group invitation policy")} disabled={isSavingProfileSettings} onChange={(groupInvitationPolicy) => void commitProfileSettings({ groupInvitationPolicy })} options={groupInvitationOptions} value={profileSettings.groupInvitationPolicy} />
              </label>
              <label className="profile-search-field">
                <span>{phrase("站内搜索", "Site search")}</span>
                <span className="profile-search-toggle">
                  <span>{phrase("允许通过站内搜索找到我", "Allow others to find me in site search")}</span>
                  <input checked={profileSettings.searchable} disabled={isSavingProfileSettings} onChange={(event) => void commitProfileSettings({ searchable: event.target.checked })} type="checkbox" />
                </span>
              </label>
            </div>
            <div className="profile-display-layout">
              <div className="profile-visibility-list">
                {([
                  ["showBio", phrase("个人介绍", "Bio")],
                  ["showJoinedAt", phrase("加入时间", "Join date")],
                  ["showStats", phrase("内容与访问统计", "Content and visit stats")],
                  ["showFollowingCount", phrase("已订阅数量", "Subscription count")],
                  ["showPinnedContent", phrase("代表内容", "Featured content")],
                ] as Array<[keyof Pick<ProfileSettings, "showBio" | "showJoinedAt" | "showStats" | "showFollowingCount" | "showPinnedContent">, string]>).map(([key, label]) => (
                  <label key={key}>
                    <span>{profileSettings[key] ? <Eye aria-hidden="true" size={16} /> : <EyeOff aria-hidden="true" size={16} />}{label}</span>
                    <input checked={profileSettings[key]} disabled={isSavingProfileSettings} onChange={(event) => void commitProfileSettings({ [key]: event.target.checked })} type="checkbox" />
                    <i />
                  </label>
                ))}
              </div>
              <div className="profile-pin-controls">
                <label><span><Pin aria-hidden="true" size={16} />{phrase("代表文章", "Featured article")}</span><GlassSelect ariaLabel={phrase("代表文章", "Featured article")} disabled={!profileSettings.showPinnedContent || isSavingProfileSettings} onChange={(value) => void commitProfileSettings({ pinnedArticleId: Number(value) || null })} options={featuredArticleOptions} value={String(profileSettings.pinnedArticleId ?? 0)} /></label>
                <label><span><BookOpen aria-hidden="true" size={16} />{phrase("代表合集", "Featured collection")}</span><GlassSelect ariaLabel={phrase("代表合集", "Featured collection")} disabled={!profileSettings.showPinnedContent || isSavingProfileSettings} onChange={(value) => void commitProfileSettings({ pinnedCollectionId: Number(value) || null })} options={featuredCollectionOptions} value={String(profileSettings.pinnedCollectionId ?? 0)} /></label>
              </div>
            </div>
          </section>

          <section className="profile-panel theme-panel">
            <div className="panel-heading">
              <span className="section-label">{phrase("主题外观", "Theme appearance")}</span>
              <strong>{phrase("外观设置", "Appearance settings")}</strong>
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
                      <span className="theme-selected">{phrase("当前", "Current")}</span>
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
                  <strong>{phrase("自定义配色", "Custom colors")}</strong>
                  <span>{phrase("使用下方颜色组合自己的主题。", "Build your own theme with the colors below.")}</span>
                </span>
                {normalizedPreference.themeId === "custom" ? (
                  <span className="theme-selected">{phrase("当前", "Current")}</span>
                ) : null}
              </button>
            </div>

            <div className="appearance-settings-grid">
              <div className="theme-control-list">
                <label className="theme-control-row range-row">
                  <span>
                    <strong>{phrase("卡片透明度", "Card opacity")}</strong>
                    <small>{cardAlpha}%</small>
                  </span>
                  <input
                    aria-label={phrase("卡片透明度", "Card opacity")}
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
                    <strong>{phrase("磨砂程度", "Glass blur")}</strong>
                    <small>{glassBlur}px</small>
                  </span>
                  <input
                    aria-label={phrase("磨砂程度", "Glass blur")}
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
                    <strong>{phrase("磨砂透明度", "Glass opacity")}</strong>
                    <small>{glassTintAlpha}%</small>
                  </span>
                  <input
                    aria-label={phrase("磨砂透明度", "Glass opacity")}
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
                <span>{phrase("预览", "Preview")}</span>
                <strong>HLOVET</strong>
                <p>{phrase("半透明玻璃会叠在背景上，磨砂颜色决定整体氛围。", "Translucent glass layers over the background, and its tint sets the overall mood.")}</p>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {user && isLevelInfoOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label={phrase("账号等级说明", "Account level guide")}
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
                <span className="section-label">{phrase("经验等级", "Experience levels")}</span>
                <strong>{phrase("成长规则", "Growth rules")}</strong>
              </div>
              <div className="level-roadmap">
                {localizedLevelRoadmap.map((role) => {
                  const isCurrent = (reputation?.level.code ?? user.role.code) === role.code;
                  return (
                    <div className={isCurrent ? "current" : ""} key={role.code}>
                      <span className="level-icon" data-role={role.code}>
                        <RoleSymbol code={role.code} />
                      </span>
                      <span>
                        <strong>{role.name}</strong>
                        <small>Lv.{role.level}</small>
                      </span>
                      <em>{isCurrent ? phrase("当前等级", "Current level") : phrase(`${role.minExperience} 经验`, `${role.minExperience} XP`)}</em>
                    </div>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}

      {isPasswordDialogOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="modal-backdrop password-modal-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closePasswordDialog();
                }
              }}
              role="presentation"
            >
              <div
                aria-labelledby="profile-password-modal-title"
                aria-modal="true"
                className="modal-panel password-modal-panel"
                role="dialog"
              >
                <div className="password-modal-heading">
                  <div className="modal-heading">
                    <span className="section-label">{phrase("账号安全", "Account security")}</span>
                    <h2 id="profile-password-modal-title">{phrase("修改密码", "Change password")}</h2>
                    <p>{phrase("修改后当前设备保持登录，其他设备将退出。", "After you change the password, this device stays signed in and other devices are signed out.")}</p>
                  </div>
                  <button
                    aria-label={phrase("关闭修改密码弹窗", "Close change-password dialog")}
                    className="level-modal-close"
                    disabled={isChangingPassword}
                    onClick={closePasswordDialog}
                    type="button"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>
                <form
                  className="form-stack modal-form"
                  onSubmit={(event) => void handlePasswordSubmit(event)}
                >
                  <label>
                    {phrase("当前密码", "Current password")}
                    <PasswordInput
                      autoComplete="current-password"
                      autoFocus
                      disabled={isChangingPassword}
                      onChange={(event) =>
                        setCurrentPassword(event.target.value)
                      }
                      required
                      value={currentPassword}
                    />
                  </label>
                  <label>
                    {phrase("新密码", "New password")}
                    <PasswordInput
                      autoComplete="new-password"
                      disabled={isChangingPassword}
                      minLength={8}
                      onChange={(event) => setNewPassword(event.target.value)}
                      required
                      value={newPassword}
                    />
                  </label>
                  <label>
                    {phrase("确认新密码", "Confirm new password")}
                    <PasswordInput
                      autoComplete="new-password"
                      disabled={isChangingPassword}
                      minLength={8}
                      onChange={(event) =>
                        setPasswordConfirmation(event.target.value)
                      }
                      required
                      value={passwordConfirmation}
                    />
                  </label>
                  <div className="actions">
                    <button
                      className="button"
                      disabled={isChangingPassword}
                      type="submit"
                    >
                      {isChangingPassword ? phrase("保存中", "Saving") : phrase("确认修改", "Confirm change")}
                    </button>
                    <button
                      className="button secondary"
                      disabled={isChangingPassword}
                      onClick={closePasswordDialog}
                      type="button"
                    >
                      {phrase("取消", "Cancel")}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isUsernameDialogOpen && typeof document !== "undefined" ? createPortal(
        <div className="modal-backdrop password-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSavingUsername) setIsUsernameDialogOpen(false); }} role="presentation">
          <div aria-modal="true" className="modal-panel password-modal-panel" role="dialog">
            <div className="password-modal-heading"><div className="modal-heading"><span className="section-label">{phrase("个人资料", "Personal profile")}</span><h2>{phrase("修改用户名", "Edit username")}</h2><p>{phrase("用户名用于 @ 提及和公开地址，30 天内只能修改一次。", "Your username is used for mentions and public URLs and can be changed once every 30 days.")}</p></div><button aria-label={phrase("关闭", "Close")} className="level-modal-close" disabled={isSavingUsername} onClick={() => setIsUsernameDialogOpen(false)} type="button"><X aria-hidden="true" size={18} /></button></div>
            <form className="form-stack modal-form" onSubmit={(event) => void handleUsernameSubmit(event)}><label>{phrase("用户名", "Username")}<input autoFocus maxLength={32} minLength={3} onChange={(event) => setUsernameDraft(event.target.value.toLowerCase())} pattern="[a-zA-Z0-9_]{3,32}" required value={usernameDraft} /></label><div className="actions"><button className="button" disabled={isSavingUsername} type="submit">{isSavingUsername ? phrase("保存中", "Saving") : phrase("保存用户名", "Save username")}</button><button className="button secondary" disabled={isSavingUsername} onClick={() => setIsUsernameDialogOpen(false)} type="button">{phrase("取消", "Cancel")}</button></div></form>
          </div>
        </div>, document.body,
      ) : null}

      <AppToast
        duration={error ? 4200 : 2600}
        message={error || toastMessage}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        persistent={
          !error &&
          (isSavingAppearance ||
            isSavingProfile ||
            isChangingPassword ||
            sessionAction !== null)
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
                aria-label={phrase("裁剪头像", "Crop avatar")}
                aria-modal="true"
                className="avatar-crop-modal"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="avatar-crop-heading">
                  <div>
                    <span className="section-label">{phrase("头像", "Avatar")}</span>
                    <strong>{phrase("调整头像", "Adjust avatar")}</strong>
                  </div>
                  <button
                    aria-label={phrase("取消裁剪头像", "Cancel avatar crop")}
                    className="level-modal-close"
                    disabled={isUploadingAvatar}
                    onClick={() => setAvatarCropSource(null)}
                    type="button"
                  >
                    ×
                  </button>
                </div>

                <div className="avatar-crop-stage">
                  <AvatarCropper
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
                    <strong>{phrase("缩放", "Zoom")}</strong>
                    <small>{Math.round(avatarZoom * 100)}%</small>
                  </span>
                  <input
                    aria-label={phrase("头像缩放", "Avatar zoom")}
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
                    {phrase("取消", "Cancel")}
                  </button>
                  <button
                    className="text-action primary"
                    disabled={isUploadingAvatar || !avatarCropPixels}
                    onClick={() => void handleAvatarCropConfirm()}
                    type="button"
                  >
                    {isUploadingAvatar ? phrase("处理中", "Processing") : phrase("使用此头像", "Use this avatar")}
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

function calculateLevelPopoverPosition(
  trigger: HTMLElement,
  measuredHeight = 520,
): LevelPopoverPosition {
  const viewportPadding = 12;
  const gap = 8;
  const triggerRect = trigger.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - viewportPadding * 2);
  const triggerCenterX = triggerRect.left + triggerRect.width / 2;
  const triggerCenterY = triggerRect.top + triggerRect.height / 2;
  const hasSpaceOnRight =
    triggerRect.right + gap + width <= window.innerWidth - viewportPadding;
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
  phrase: (chinese: string, english: string) => string,
): Promise<File> {
  const image = await loadImage(source, phrase);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error(phrase("当前浏览器无法处理头像图片。", "This browser cannot process avatar images."));
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
          reject(new Error(phrase("头像裁剪失败，请重新选择图片。", "Could not crop the avatar. Choose the image again.")));
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

function loadImage(source: string, phrase: (chinese: string, english: string) => string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(phrase("无法读取所选头像图片。", "Could not read the selected avatar image.")));
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

function formatJoinedAt(value: Date, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatDuration(value: number, locale: "zh-CN" | "en-US"): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return locale === "en-US"
    ? `${days}d ${hours}h ${minutes}m ${seconds}s`
    : `${days}天 ${hours}小时 ${minutes}分 ${seconds}秒`;
}

function formatSessionTime(value: string, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatReputationTime(value: string, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSessionDevice(userAgent: string, locale: "zh-CN" | "en-US"): string {
  if (!userAgent || userAgent === "unknown") {
    return locale === "en-US" ? "Unknown device" : "未知设备";
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
            : locale === "en-US" ? "Other device" : "其他设备";
  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /Chrome\//i.test(userAgent)
      ? "Chrome"
      : /Firefox\//i.test(userAgent)
        ? "Firefox"
        : /Safari\//i.test(userAgent)
          ? "Safari"
          : locale === "en-US" ? "Browser" : "浏览器";
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
