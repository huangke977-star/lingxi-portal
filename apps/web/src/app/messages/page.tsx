"use client";

/* eslint-disable @next/next/no-img-element */

import { Check, ChevronUp, MessageCircle, Send, UserPlus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AppToast } from "@/components/app-toast";
import { RoleSymbol } from "@/components/role-symbol";
import { getMe, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  ChatMessage,
  Conversation,
  Friendship,
  getChatSocketOrigin,
  getOrCreateConversation,
  listConversations,
  listFriendships,
  listMessages,
  markConversationRead,
  respondFriendRequest,
  SocialUser,
} from "@/lib/social-api";
import { getAvatarFallbackText } from "@/lib/user-display";

interface ChatAck {
  ok: boolean;
  message?: ChatMessage;
  error?: string;
}

export default function MessagesPage() {
  return <Suspense fallback={<section className="page-shell messages-page"><div className="article-empty-state">正在读取消息中心。</div></section>}><MessagesContent /></Suspense>;
}

function MessagesContent() {
  const searchParams = useSearchParams();
  const requestedConversationId = Number(searchParams.get("conversation") ?? 0);
  const socketRef = useRef<Socket | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friendships, setFriendships] = useState<{ friends: Friendship[]; incoming: Friendship[]; outgoing: Friendship[] }>({ friends: [], incoming: [], outgoing: [] });
  const [selectedId, setSelectedId] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      window.location.href = "/login?from=%2Fmessages";
      return;
    }
    Promise.all([getMe(token), listConversations(token), listFriendships(token)])
      .then(([currentUser, conversationResult, friendshipResult]) => {
        setUser(currentUser);
        setConversations(conversationResult.items);
        setFriendships(friendshipResult);
        const initialId = requestedConversationId && conversationResult.items.some((item) => item.id === requestedConversationId)
          ? requestedConversationId
          : conversationResult.items[0]?.id ?? 0;
        setSelectedId(initialId);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "消息中心加载失败。"))
      .finally(() => setIsLoading(false));
  }, [requestedConversationId]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token || !user) return;
    const socket = io(`${getChatSocketOrigin()}/chat`, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    socketRef.current = socket;
    socket.on("chat:message", (message: ChatMessage) => {
      setConversations((current) => {
        const existing = current.find((item) => item.id === message.conversationId);
        if (!existing) return current;
        const updated = {
          ...existing,
          lastMessage: message,
          updatedAt: message.createdAt,
          unreadCount: message.sender.id !== user.id && message.conversationId !== selectedIdRef.current
            ? existing.unreadCount + 1
            : existing.unreadCount,
        };
        return [updated, ...current.filter((item) => item.id !== updated.id)];
      });
      if (message.conversationId === selectedIdRef.current) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        if (message.sender.id !== user.id) {
          socket.emit("chat:read", { conversationId: selectedIdRef.current });
        }
      }
    });
    socket.on("chat:read", (payload: { conversationId: number; readerId: number; readAt: string }) => {
      if (payload.conversationId === selectedIdRef.current && payload.readerId !== user.id) {
        setMessages((current) => current.map((message) => message.sender.id === user.id && !message.readAt ? { ...message, readAt: payload.readAt } : message));
      }
    });
    socket.on("chat:error", (payload: { message?: string }) => setError(payload.message || "聊天连接出现问题。"));
    socket.on("chat:reauthenticate", () => {
      const latestToken = readAccessToken();
      if (latestToken) socket.auth = { token: latestToken };
    });
    socket.on("disconnect", (reason) => {
      if (reason !== "io server disconnect") return;
      window.setTimeout(() => {
        const latestToken = readAccessToken();
        if (!latestToken) return;
        socket.auth = { token: latestToken };
        socket.connect();
      }, 600);
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token || !selectedId) {
      return;
    }
    // A conversation switch starts an asynchronous history request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMessagesLoading(true);
    listMessages(token, selectedId)
      .then((result) => {
        setMessages(result.items);
        setHasMore(result.hasMore);
        setConversations((current) => current.map((item) => item.id === selectedId ? { ...item, unreadCount: 0 } : item));
        return markConversationRead(token, selectedId);
      })
      .then(() => socketRef.current?.emit("chat:read", { conversationId: selectedId }))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "聊天记录加载失败。"))
      .finally(() => setIsMessagesLoading(false));
  }, [selectedId]);

  useEffect(() => {
    if (!isMessagesLoading) {
      window.requestAnimationFrame(() => {
        const list = messageListRef.current;
        if (list) list.scrollTop = list.scrollHeight;
      });
    }
  }, [isMessagesLoading, messages.length]);

  async function loadOlderMessages() {
    const token = readAccessToken();
    const firstId = messages[0]?.id;
    if (!token || !selectedId || !firstId) return;
    try {
      const result = await listMessages(token, selectedId, firstId);
      setMessages((current) => [...result.items, ...current]);
      setHasMore(result.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "更早的消息加载失败。");
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    const socket = socketRef.current;
    if (!body || !selectedId || !socket?.connected) {
      if (!socket?.connected) setError("聊天连接尚未建立，请稍后重试。");
      return;
    }
    setIsSending(true);
    try {
      const response = await socket.timeout(8000).emitWithAck("chat:send", { conversationId: selectedId, body }) as ChatAck;
      if (!response.ok) throw new Error(response.error || "消息发送失败。");
      setDraft("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "消息发送失败。");
    } finally {
      setIsSending(false);
    }
  }

  async function handleFriendRequest(friendship: Friendship, status: "accepted" | "declined") {
    const token = readAccessToken();
    if (!token) return;
    try {
      await respondFriendRequest(token, friendship.id, status);
      setFriendships(await listFriendships(token));
      setNotice(status === "accepted" ? "已成为好友。" : "已拒绝好友申请。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "好友申请处理失败。");
    }
  }

  async function openFriendChat(friend: Friendship) {
    const token = readAccessToken();
    if (!token) return;
    try {
      const conversation = await getOrCreateConversation(token, friend.user.id);
      setConversations((current) => current.some((item) => item.id === conversation.id) ? current : [conversation, ...current]);
      setSelectedId(conversation.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "会话创建失败。");
    }
  }

  if (isLoading) return <section className="page-shell messages-page"><div className="article-empty-state">正在读取消息中心。</div></section>;

  return (
    <section className="page-shell messages-page">
      <div className="messages-layout">
        <aside className="messages-sidebar">
          <div className="messages-sidebar-heading"><div><MessageCircle aria-hidden="true" size={19} /><strong>消息</strong></div><span>{conversations.reduce((total, item) => total + item.unreadCount, 0)}</span></div>
          {friendships.incoming.length ? <section className="friend-request-list"><h2><UserPlus aria-hidden="true" size={15} />好友申请</h2>{friendships.incoming.map((friendship) => <div className="friend-request-row" key={friendship.id}><UserAvatar user={friendship.user} /><span><strong>{friendship.user.nickname}</strong><small>@{friendship.user.username}</small></span><button onClick={() => void handleFriendRequest(friendship, "accepted")} title="接受" type="button"><Check aria-hidden="true" size={15} /></button><button onClick={() => void handleFriendRequest(friendship, "declined")} title="拒绝" type="button"><X aria-hidden="true" size={15} /></button></div>)}</section> : null}
          <div className="conversation-list">{conversations.map((conversation) => <button className={conversation.id === selectedId ? "active" : undefined} key={conversation.id} onClick={() => setSelectedId(conversation.id)} type="button"><UserAvatar user={conversation.user} /><span><strong>{conversation.user.nickname}</strong><small>{conversation.lastMessage?.body ?? "开始聊天"}</small></span>{conversation.unreadCount ? <b>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</b> : null}</button>)}</div>
          {friendships.friends.some((friendship) => !conversations.some((conversation) => conversation.user.id === friendship.user.id)) ? <section className="friend-contact-list"><h2>好友</h2>{friendships.friends.filter((friendship) => !conversations.some((conversation) => conversation.user.id === friendship.user.id)).map((friendship) => <button key={friendship.id} onClick={() => void openFriendChat(friendship)} type="button"><UserAvatar user={friendship.user} /><span>{friendship.user.nickname}</span><MessageCircle aria-hidden="true" size={15} /></button>)}</section> : null}
        </aside>
        <main className="chat-panel">
          {selected && user ? <>
            <header className="chat-heading"><UserAvatar user={selected.user} large /><div><strong>{selected.user.nickname}</strong><span><RoleSymbol code={selected.user.isSuperAdmin ? "super_administrator" : selected.user.role.code} />{selected.user.role.name}</span></div></header>
            <div className="chat-message-list" ref={messageListRef}>{hasMore ? <button className="chat-load-older" onClick={() => void loadOlderMessages()} type="button"><ChevronUp aria-hidden="true" size={14} />更早消息</button> : null}{isMessagesLoading ? <span className="chat-state">正在读取聊天记录。</span> : messages.map((message) => <div className={`chat-message ${message.sender.id === user.id ? "mine" : "theirs"}`} key={message.id}><UserAvatar user={message.sender} /><div><p>{message.body}</p><span>{formatChatTime(message.createdAt)}{message.sender.id === user.id ? ` · ${message.readAt ? "已读" : "未读"}` : ""}</span></div></div>)}</div>
            <form className="chat-composer" onSubmit={sendMessage}><textarea aria-label={`给 ${selected.user.nickname} 发消息`} maxLength={2000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="输入消息，Shift + Enter 换行" rows={2} value={draft} /><button aria-label="发送消息" disabled={isSending || !draft.trim()} title="发送消息" type="submit"><Send aria-hidden="true" size={18} /></button></form>
          </> : <div className="chat-empty"><MessageCircle aria-hidden="true" size={28} /><strong>选择一位好友开始聊天</strong><span>消息历史保存在服务器中，实时消息通过加密连接传输。</span></div>}
        </main>
      </div>
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function UserAvatar({ user, large = false }: { user: SocialUser; large?: boolean }) {
  const avatar = user.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  return <span className={`chat-user-avatar${large ? " large" : ""}`}>{avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText(user)}</span>;
}

function formatChatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
