"use client";

/* eslint-disable @next/next/no-img-element */

import { Check, Clock3, MessageCircle, UserPlus, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoleSymbol } from "@/components/role-symbol";
import type { ArticleAuthor } from "@/lib/article-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  getOrCreateConversation,
  getPublicProfile,
  PublicProfile,
  requestFriend,
  respondFriendRequest,
} from "@/lib/social-api";
import { notifySocialStateChange, openChatDock } from "@/lib/social-events";
import { getAvatarFallbackText } from "@/lib/user-display";

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
  const [error, setError] = useState("");
  const avatar = author.avatarUrl ? resolveApiUrl(author.avatarUrl) : null;
  const roleCode = author.isSuperAdmin ? "super_administrator" : author.role.code;
  const roleName = author.isSuperAdmin ? "超级管理员" : author.role.name;

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
      setError(loadError instanceof Error ? loadError.message : "用户资料加载失败。");
    } finally {
      setIsLoading(false);
    }
  }

  async function addFriend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setError(actionError instanceof Error ? actionError.message : "好友申请发送失败。");
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
      setError(actionError instanceof Error ? actionError.message : "好友申请处理失败。");
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
      setError(actionError instanceof Error ? actionError.message : "会话创建失败。");
    } finally {
      setIsActing(false);
    }
  }

  function goToLogin() {
    router.push(`/login?from=${encodeURIComponent(pathname)}`);
  }

  const relationship = profile?.relationship;
  const displayProfile = profile ?? {
    ...author,
    profileBio: "登录后可查看公开资料并进行互动。",
    createdAt: "",
    isSelf: false,
    relationship: null,
  };

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-label={`查看 ${author.nickname} 的公开资料`}
        className="comment-avatar-button"
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); void openProfile(); }}
        ref={triggerRef}
        type="button"
      >
        {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText({ nickname: author.nickname, username: author.username })}
      </button>
      {isOpen && typeof document !== "undefined" ? createPortal(
        <div className="public-profile-popover" ref={panelRef} style={position}>
          <div className="public-profile-head">
            <span className="public-profile-avatar">
              {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText({ nickname: author.nickname, username: author.username })}
            </span>
            <div>
              <strong>{displayProfile.nickname}</strong>
              <span>@{displayProfile.username}</span>
            </div>
            <span className="public-profile-role" title={roleName}><RoleSymbol code={roleCode} />{roleName}</span>
          </div>
          <p>{displayProfile.profileBio}</p>
          {displayProfile.createdAt ? <span className="public-profile-since"><Clock3 aria-hidden="true" size={14} />加入于 {new Date(displayProfile.createdAt).toLocaleDateString("zh-CN")}</span> : null}
          {isLoading ? <span className="public-profile-state">正在读取公开资料。</span> : null}
          {error ? <span className="public-profile-error">{error}</span> : null}
          <div className="public-profile-actions">
            {!readAccessToken() ? <button onClick={goToLogin} type="button">登录后互动</button> : null}
            {profile && !profile.isSelf && !relationship && !isFriendNoteOpen ? <button disabled={isActing} onClick={() => setIsFriendNoteOpen(true)} type="button"><UserPlus aria-hidden="true" size={15} />加好友</button> : null}
            {relationship?.direction === "outgoing" ? <span><Clock3 aria-hidden="true" size={14} />等待对方确认</span> : null}
            {relationship?.direction === "incoming" ? <><button disabled={isActing} onClick={() => void respond("accepted")} type="button"><Check aria-hidden="true" size={15} />接受</button><button disabled={isActing} onClick={() => void respond("declined")} type="button"><X aria-hidden="true" size={15} />拒绝</button></> : null}
            {relationship?.direction === "accepted" ? <button disabled={isActing} onClick={() => void startChat()} type="button"><MessageCircle aria-hidden="true" size={15} />发消息</button> : null}
          </div>
          {profile && !profile.isSelf && !relationship && isFriendNoteOpen ? <form className="friend-request-note-form" onSubmit={addFriend}><textarea autoFocus maxLength={120} onChange={(event) => setFriendNote(event.target.value)} placeholder="申请备注，可不填" rows={2} value={friendNote} /><div><span>{friendNote.length} / 120</span><button disabled={isActing} type="submit">{isActing ? "发送中" : "发送申请"}</button><button onClick={() => { setIsFriendNoteOpen(false); setFriendNote(""); }} type="button">取消</button></div></form> : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export function CommentAuthorIdentity({ author }: { author: ArticleAuthor }) {
  const roleCode = author.isSuperAdmin ? "super_administrator" : author.role.code;
  const roleName = author.isSuperAdmin ? "超级管理员" : author.role.name;
  return (
    <span className="comment-author-identity">
      <PublicProfilePopover author={author} />
      <strong>{author.nickname}</strong>
      <span className="comment-role-icon" title={roleName}><RoleSymbol code={roleCode} /></span>
    </span>
  );
}
