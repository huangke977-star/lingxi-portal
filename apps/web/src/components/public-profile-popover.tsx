"use client";

/* eslint-disable @next/next/no-img-element */

import { Check, Clock3, MessageCircle, Send, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppToast } from "@/components/app-toast";
import { RequestComposerDialog } from "@/components/request-composer-dialog";
import { RoleSymbol } from "@/components/role-symbol";
import { AvatarManagementBadge, ManagementIdentitySymbol } from "@/components/user-identity-badges";
import type { ArticleAuthor } from "@/lib/article-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  getOrCreateConversation,
  getPublicProfile,
  createStrangerMessageRequest,
  PublicProfile,
  requestFriend,
  respondFriendRequest,
} from "@/lib/social-api";
import { notifySocialStateChange, openChatDock } from "@/lib/social-events";
import { getAvatarFallbackText } from "@/lib/user-display";
import { getManagementIdentity } from "@/lib/user-permissions";
import { useLanguage } from "@/components/language-provider";
import { localizedPath } from "@/lib/i18n";
import { growthLevelLabel } from "@/lib/system-labels";

interface Position {
  left: number;
  top: number;
}

export function PublicProfilePopover({ author }: { author: ArticleAuthor }) {
  const router = useRouter();
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 12, top: 12 });
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isFriendNoteOpen, setIsFriendNoteOpen] = useState(false);
  const [friendNote, setFriendNote] = useState("");
  const [isMessageRequestOpen, setIsMessageRequestOpen] = useState(false);
  const [messageRequestBody, setMessageRequestBody] = useState("");
  const [error, setError] = useState("");
  const avatar = author.avatarUrl ? resolveApiUrl(author.avatarUrl) : null;
  const management = getManagementIdentity(author);
  const { locale, t } = useLanguage();

  useEffect(() => {
    if (!isOpen) return;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const estimatedHeight = 260;
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      const top = rect.bottom + estimatedHeight + 12 <= window.innerHeight
        ? rect.bottom + 8
        : Math.max(12, rect.top - estimatedHeight - 8);
      setPosition({ left, top });
    }
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      function handlePointerDown(event: PointerEvent) {
        const path = event.composedPath();
        if (triggerRef.current && path.includes(triggerRef.current)) return;
        if (panelRef.current && path.includes(panelRef.current)) return;
        setIsOpen(false);
      }
      document.addEventListener("pointerdown", handlePointerDown);
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      cleanup = () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    });
    let cleanup = () => undefined;
    return () => {
      window.cancelAnimationFrame(frame);
      cleanup();
    };
  }, [isOpen]);

  if (author.isDeleted) {
    return <span className="identity-badged-avatar"><span className="comment-avatar-button">{getAvatarFallbackText({ nickname: locale === "en-US" ? "Deleted user" : "已注销用户", username: "deleted-user" })}</span><span className="article-author-profile-link">{locale === "en-US" ? "Deleted user" : "已注销用户"}</span></span>;
  }

  async function openProfile() {
    setIsOpen((current) => !current);
    if (profile || isLoading) return;
    const token = readAccessToken();
    if (!token) return;
    setIsLoading(true);
    setError("");
    try {
      setProfile(await getPublicProfile(token, author.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("profile.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  async function addFriend() {
    const token = readAccessToken();
    if (!token) return goToLogin();
    setIsActing(true);
    try {
      await requestFriend(token, author.id, friendNote.trim() || undefined);
      setProfile(await getPublicProfile(token, author.id));
      setFriendNote("");
      setIsFriendNoteOpen(false);
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("profile.friendRequestFailed"));
    } finally {
      setIsActing(false);
    }
  }

  async function respond(status: "accepted" | "declined") {
    const token = readAccessToken();
    const relationshipId = profile?.relationship?.id;
    if (!token || !relationshipId) return;
    setIsActing(true);
    try {
      await respondFriendRequest(token, relationshipId, status);
      setProfile(await getPublicProfile(token, author.id));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("profile.friendRequestHandleFailed"));
    } finally {
      setIsActing(false);
    }
  }

  async function startChat() {
    const token = readAccessToken();
    if (!token) return goToLogin();
    setIsActing(true);
    try {
      const conversation = await getOrCreateConversation(token, author.id);
      setIsOpen(false);
      openChatDock({ conversationId: conversation.id });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("profile.conversationFailed"));
    } finally {
      setIsActing(false);
    }
  }

  async function sendMessageRequest() {
    const token = readAccessToken();
    const body = messageRequestBody.trim();
    if (!token) return goToLogin();
    if (!body) return;
    setIsActing(true);
    try {
      await createStrangerMessageRequest(token, author.id, body);
      setMessageRequestBody("");
      setIsMessageRequestOpen(false);
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("profile.messageRequestFailed"));
    } finally {
      setIsActing(false);
    }
  }

  function goToLogin() {
    router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(pathname)}`);
  }

  const relationship = profile?.relationship;
  const displayProfile = profile ?? {
    ...author,
    profileBio: t("profile.signInForProfile"),
    createdAt: "",
    isSelf: false,
    subscribed: false,
    subscriberCount: 0,
    followingCount: 0,
    publicArticleCount: 0,
    receivedLikeCount: 0,
    publicViewCount: 0,
    relationship: null,
    canRequestFriend: true,
    messageAccess: "none" as const,
  };

  return (
    <>
      <span className="identity-badged-avatar">
        <button
          aria-expanded={isOpen}
          aria-label={t("profile.publicProfile", { name: author.nickname })}
          className="comment-avatar-button"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); void openProfile(); }}
          ref={triggerRef}
          type="button"
        >
          {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText({ nickname: author.nickname, username: author.username })}
        </button>
        <AvatarManagementBadge user={author} />
      </span>
      {isOpen && typeof document !== "undefined" ? createPortal(
        <div className="public-profile-popover" ref={panelRef} style={position}>
          <div className="public-profile-head">
            <span className="public-profile-avatar identity-avatar-host">
              <span className="identity-avatar-visual">{avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText({ nickname: author.nickname, username: author.username })}</span>
              <AvatarManagementBadge user={author} />
            </span>
            <div>
              <strong>{displayProfile.nickname}</strong>
              <span>@{displayProfile.username}</span>
            </div>
            <span className="public-profile-identities">
              <span className="public-profile-role" title={t("profile.level", { name: growthLevelLabel(author.role.code, locale, author.role.name) })}><RoleSymbol code={author.role.code} />{growthLevelLabel(author.role.code, locale, author.role.name)}</span>
              {management ? <span className="public-profile-role" title={management.label}><ManagementIdentitySymbol user={author} />{management.label}</span> : null}
            </span>
          </div>
          {displayProfile.profileBio ? <p>{displayProfile.profileBio}</p> : null}
          {displayProfile.createdAt ? <span className="public-profile-since"><Clock3 aria-hidden="true" size={14} />{t("profile.joinedAt", { date: new Intl.DateTimeFormat(locale).format(new Date(displayProfile.createdAt)) })}</span> : null}
          {profile?.subscriberCount !== null && profile?.subscriberCount !== undefined ? <span className="public-profile-since">{t("profile.subscriberCount", { count: profile.subscriberCount })}</span> : null}
          {isLoading ? <span className="public-profile-state">{t("profile.loading")}</span> : null}
          {error ? <span className="public-profile-error">{error}</span> : null}
          <div className="public-profile-actions">
            <Link href={localizedPath(`/users/${encodeURIComponent(author.username)}`, locale)} onClick={() => setIsOpen(false)}>{t("profile.viewHomepage")}</Link>
            {!readAccessToken() ? <button onClick={goToLogin} type="button">{t("profile.loginToInteract")}</button> : null}
            {profile && !profile.isSelf && !relationship && profile.canRequestFriend ? <button disabled={isActing} onClick={() => { setError(""); setIsOpen(false); setIsMessageRequestOpen(false); setIsFriendNoteOpen(true); }} type="button"><UserPlus aria-hidden="true" size={15} />{t("profile.addFriend")}</button> : null}
            {relationship?.direction === "outgoing" ? <span><Clock3 aria-hidden="true" size={14} />{t("profile.waitingForFriend")}</span> : null}
            {relationship?.direction === "incoming" ? <><button disabled={isActing} onClick={() => void respond("accepted")} type="button"><Check aria-hidden="true" size={15} />{t("profile.accept")}</button><button disabled={isActing} onClick={() => void respond("declined")} type="button"><X aria-hidden="true" size={15} />{t("profile.decline")}</button></> : null}
            {profile?.messageAccess === "conversation" ? <button disabled={isActing} onClick={() => void startChat()} type="button"><MessageCircle aria-hidden="true" size={15} />{t("profile.sendMessage")}</button> : null}
            {profile?.messageAccess === "request" ? <button disabled={isActing} onClick={() => { setError(""); setIsOpen(false); setIsFriendNoteOpen(false); setIsMessageRequestOpen(true); }} type="button"><Send aria-hidden="true" size={15} />{t("profile.messageRequest")}</button> : null}
          </div>
        </div>,
        document.body,
      ) : null}
      {isFriendNoteOpen ? <RequestComposerDialog icon={<UserPlus aria-hidden="true" size={18} />} isSubmitting={isActing} label={t("profile.friendNote")} maxLength={120} onChange={setFriendNote} onClose={() => { setIsFriendNoteOpen(false); setFriendNote(""); }} onSubmit={() => void addFriend()} placeholder={t("profile.friendNotePlaceholder")} submitLabel={t("profile.sendFriendRequest")} title={t("profile.addFriendTitle", { name: author.nickname })} value={friendNote} /> : null}
      {isMessageRequestOpen ? <RequestComposerDialog icon={<Send aria-hidden="true" size={18} />} isSubmitting={isActing} label={t("profile.firstMessage")} maxLength={500} onChange={setMessageRequestBody} onClose={() => { setIsMessageRequestOpen(false); setMessageRequestBody(""); }} onSubmit={() => void sendMessageRequest()} placeholder={t("profile.firstMessagePlaceholder")} requireContent submitLabel={t("profile.sendMessageRequest")} title={t("profile.sendMessageRequestTitle")} value={messageRequestBody} /> : null}
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </>
  );
}

export function CommentAuthorIdentity({ author }: { author: ArticleAuthor }) {
  const { locale, t } = useLanguage();
  return (
    <span className="comment-author-identity">
      <PublicProfilePopover author={author} />
      <Link className="comment-author-profile-link" href={localizedPath(`/users/${encodeURIComponent(author.username)}`, locale)}>{author.nickname}</Link>
      <span className="comment-role-icon" title={t("profile.level", { name: growthLevelLabel(author.role.code, locale, author.role.name) })}><RoleSymbol code={author.role.code} /></span>
    </span>
  );
}
