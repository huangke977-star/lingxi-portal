"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Bell,
  Check,
  ChevronLeft,
  ChevronUp,
  Download,
  FileText,
  Image as ImageIcon,
  Laugh,
  LoaderCircle,
  MessageCircle,
  MessageCircleMore,
  Minus,
  Paperclip,
  Send,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import { AppToast } from "@/components/app-toast";
import { RoleSymbol } from "@/components/role-symbol";
import { getMe, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  readAccessToken,
} from "@/lib/auth-storage";
import {
  type ChatAttachment,
  type ChatMessage,
  type Conversation,
  type Friendship,
  type SocialNotification,
  type SocialUser,
  downloadChatAttachment,
  getChatSocketOrigin,
  getOrCreateConversation,
  listConversations,
  listFriendships,
  listMessages,
  listNotifications,
  markAllNotificationsRead,
  markConversationRead,
  markNotificationRead,
  respondFriendRequest,
  uploadChatAttachments,
} from "@/lib/social-api";
import {
  CHAT_DOCK_OPEN_EVENT,
  CHAT_DOCK_TOGGLE_EVENT,
  SOCIAL_STATE_CHANGE_EVENT,
  type ChatDockOpenDetail,
  notifySocialStateChange,
} from "@/lib/social-events";
import { getAvatarFallbackText } from "@/lib/user-display";

const MAX_ATTACHMENTS = 9;
const SYSTEM_CONVERSATION_ID = -1;
const DOCK_GEOMETRY_STORAGE_KEY = "hlovet-chat-dock-geometry";
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_BATCH_SIZE = 50 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  "bat", "cmd", "com", "cpl", "exe", "hta", "jar", "js", "jse", "msi",
  "msp", "pif", "ps1", "scr", "sh", "vbe", "vbs", "wsf", "wsh",
]);
const EMOJIS = [
  "😀", "😄", "😁", "😂", "😊", "😍", "🥰", "😎",
  "🤔", "😅", "😭", "😡", "👍", "👏", "🙏", "🎉",
  "❤️", "🔥", "✨", "💡", "✅", "👀", "🤝", "🌙",
];

interface ChatAck {
  ok: boolean;
  message?: ChatMessage;
  error?: string;
}

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

type DockTab = "chats" | "friends";

interface DockGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ChatDock() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const systemMessageListRef = useRef<HTMLDivElement | null>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const selectedIdRef = useRef(0);
  const sessionUserIdRef = useRef(0);
  const openRef = useRef(false);
  const minimizedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friendships, setFriendships] = useState<{
    friends: Friendship[];
    incoming: Friendship[];
    outgoing: Friendship[];
  }>({ friends: [], incoming: [], outgoing: [] });
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [selectedId, setSelectedId] = useState(0);
  const [selectedSystemNotificationId, setSelectedSystemNotificationId] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [pendingAttachmentsByConversation, setPendingAttachmentsByConversation] = useState<Record<number, PendingAttachment[]>>({});
  const [hasMore, setHasMore] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [dockGeometry, setDockGeometry] = useState<DockGeometry | null>(null);
  const [activeTab, setActiveTab] = useState<DockTab>("chats");
  const [isMobileConversationOpen, setIsMobileConversationOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const systemNotifications = useMemo(
    () => notifications.filter((item) => item.type !== "friend_request_received"),
    [notifications],
  );
  const isSystemSelected = selectedId === SYSTEM_CONVERSATION_ID;
  const draft = selectedId ? drafts[selectedId] ?? "" : "";
  const pendingAttachments = selectedId ? pendingAttachmentsByConversation[selectedId] ?? [] : [];
  const unreadMessages = conversations.reduce((total, item) => total + item.unreadCount, 0);
  const unreadNotifications = systemNotifications.filter((item) => !item.readAt).length;
  const dockUnreadCount = unreadMessages + unreadNotifications + friendships.incoming.length;
  const userId = user?.id ?? 0;
  const closeAttachmentPreview = useCallback(() => setPreviewAttachment(null), []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    openRef.current = isOpen;
    minimizedRef.current = isMinimized;
  }, [isMinimized, isOpen]);

  useEffect(() => {
    function synchronizeGeometry() {
      const desktop = window.innerWidth > 760;
      setIsDesktop(desktop);
      if (!desktop) return;
      setDockGeometry((current) => clampDockGeometry(
        current ?? readDockGeometry() ?? getDefaultDockGeometry(),
      ));
    }
    synchronizeGeometry();
    window.addEventListener("resize", synchronizeGeometry);
    return () => window.removeEventListener("resize", synchronizeGeometry);
  }, []);

  useEffect(() => {
    if (!isDesktop || !dockGeometry) return;
    window.localStorage.setItem(DOCK_GEOMETRY_STORAGE_KEY, JSON.stringify(dockGeometry));
  }, [dockGeometry, isDesktop]);

  const refreshSocialData = useCallback(async (showLoading = false) => {
    const token = readAccessToken();
    if (!token) {
      pendingAttachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      sessionUserIdRef.current = 0;
      setUser(null);
      setConversations([]);
      setFriendships({ friends: [], incoming: [], outgoing: [] });
      setNotifications([]);
      setSelectedId(0);
      setMessages([]);
      setDrafts({});
      setPendingAttachmentsByConversation({});
      setIsOpen(false);
      return;
    }
    if (showLoading) setIsLoading(true);
    try {
      const [currentUser, conversationResult, friendshipResult, notificationResult] = await Promise.all([
        getMe(token),
        listConversations(token),
        listFriendships(token),
        listNotifications(token),
      ]);
      if (sessionUserIdRef.current && sessionUserIdRef.current !== currentUser.id) {
        pendingAttachmentsRef.current.forEach((attachment) => {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        });
        setDrafts({});
        setPendingAttachmentsByConversation({});
      }
      sessionUserIdRef.current = currentUser.id;
      setUser(currentUser);
      setConversations(conversationResult.items);
      setFriendships(friendshipResult);
      setNotifications(notificationResult.items);
      setSelectedId((current) => {
        if (current === SYSTEM_CONVERSATION_ID) return current;
        if (current && conversationResult.items.some((item) => item.id === current)) return current;
        return conversationResult.items[0]?.id ?? SYSTEM_CONVERSATION_ID;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "消息数据加载失败。");
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial loading is an external session synchronization.
    void refreshSocialData(true);
    const handleRefresh = () => void refreshSocialData();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, handleRefresh);
    window.addEventListener(SOCIAL_STATE_CHANGE_EVENT, handleRefresh);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshSocialData();
    }, 15000);
    return () => {
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, handleRefresh);
      window.removeEventListener(SOCIAL_STATE_CHANGE_EVENT, handleRefresh);
      window.clearInterval(timer);
    };
  }, [refreshSocialData]);

  useEffect(() => {
    async function handleOpen(event: Event) {
      const detail = (event as CustomEvent<ChatDockOpenDetail>).detail ?? {};
      setIsOpen(true);
      setIsMinimized(false);
      setActiveTab(detail.tab ?? "chats");
      if (detail.tab === "friends") setIsMobileConversationOpen(false);
      if (detail.systemNotificationId) {
        setSelectedId(SYSTEM_CONVERSATION_ID);
        setSelectedSystemNotificationId(detail.systemNotificationId);
        setActiveTab("chats");
        setIsMobileConversationOpen(true);
        return;
      }
      if (detail.conversationId) {
        setSelectedId(detail.conversationId);
        setIsMobileConversationOpen(true);
        return;
      }
      if (!detail.userId) return;
      const token = readAccessToken();
      if (!token) return;
      try {
        const conversation = await getOrCreateConversation(token, detail.userId);
        setConversations((current) => current.some((item) => item.id === conversation.id)
          ? current
          : [conversation, ...current]);
        setSelectedId(conversation.id);
        setIsMobileConversationOpen(true);
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : "会话创建失败。");
      }
    }
    function handleToggle() {
      if (openRef.current && !minimizedRef.current) {
        setIsMinimized(true);
      } else {
        setIsOpen(true);
        setIsMinimized(false);
      }
    }
    window.addEventListener(CHAT_DOCK_OPEN_EVENT, handleOpen);
    window.addEventListener(CHAT_DOCK_TOGGLE_EVENT, handleToggle);
    return () => {
      window.removeEventListener(CHAT_DOCK_OPEN_EVENT, handleOpen);
      window.removeEventListener(CHAT_DOCK_TOGGLE_EVENT, handleToggle);
    };
  }, []);

  useEffect(() => {
    if (!isSystemSelected || !selectedSystemNotificationId || !isOpen || isMinimized) return;
    window.requestAnimationFrame(() => {
      const item = systemMessageListRef.current?.querySelector<HTMLElement>(
        `[data-notification-id="${selectedSystemNotificationId}"]`,
      );
      item?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [isMinimized, isOpen, isSystemSelected, selectedSystemNotificationId]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token || !userId) return;
    const socket = io(`${getChatSocketOrigin()}/chat`, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    socketRef.current = socket;
    socket.on("chat:message", (message: ChatMessage) => {
      const isViewing = message.conversationId === selectedIdRef.current && openRef.current && !minimizedRef.current;
      setConversations((current) => {
        const existing = current.find((item) => item.id === message.conversationId);
        if (!existing) {
          void refreshSocialData();
          return current;
        }
        const updated = {
          ...existing,
          lastMessage: message,
          updatedAt: message.createdAt,
          unreadCount: message.sender.id !== userId && !isViewing
            ? existing.unreadCount + 1
            : existing.unreadCount,
        };
        return [updated, ...current.filter((item) => item.id !== updated.id)];
      });
      if (message.conversationId === selectedIdRef.current) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        if (message.sender.id !== userId && isViewing) {
          socket.emit("chat:read", { conversationId: message.conversationId });
          void markConversationRead(token, message.conversationId);
        }
      }
      notifySocialStateChange();
    });
    socket.on("chat:read", (payload: { conversationId: number; readerId: number; readAt: string }) => {
      if (payload.conversationId === selectedIdRef.current && payload.readerId !== userId) {
        setMessages((current) => current.map((message) =>
          message.sender.id === userId && !message.readAt ? { ...message, readAt: payload.readAt } : message,
        ));
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
  }, [refreshSocialData, userId]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token || selectedId <= 0) {
      // A cleared session also clears the locally displayed conversation.
      setMessages([]);
      return;
    }
    setIsMessagesLoading(true);
    listMessages(token, selectedId)
      .then((result) => {
        setMessages(result.items);
        setHasMore(result.hasMore);
        setConversations((current) => current.map((item) =>
          item.id === selectedId ? { ...item, unreadCount: 0 } : item,
        ));
        return markConversationRead(token, selectedId);
      })
      .then(() => {
        socketRef.current?.emit("chat:read", { conversationId: selectedId });
        notifySocialStateChange();
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "聊天记录加载失败。"))
      .finally(() => setIsMessagesLoading(false));
  }, [selectedId]);

  useEffect(() => {
    if (!isMessagesLoading && isOpen && !isMinimized) {
      window.requestAnimationFrame(() => {
        const list = messageListRef.current;
        if (list) list.scrollTop = list.scrollHeight;
      });
    }
  }, [isMessagesLoading, isMinimized, isOpen, messages.length]);

  useEffect(() => {
    pendingAttachmentsRef.current = Object.values(pendingAttachmentsByConversation).flat();
  }, [pendingAttachmentsByConversation]);

  useEffect(() => () => {
    pendingAttachmentsRef.current.forEach((attachment) => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
  }, []);

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

  function updateDraft(value: string) {
    if (!selectedId) return;
    setDrafts((current) => ({ ...current, [selectedId]: value }));
  }

  function setPendingAttachments(
    value: PendingAttachment[] | ((current: PendingAttachment[]) => PendingAttachment[]),
  ) {
    if (!selectedId) return;
    setPendingAttachmentsByConversation((current) => {
      const existing = current[selectedId] ?? [];
      const next = typeof value === "function" ? value(existing) : value;
      if (!next.length) {
        const { [selectedId]: _removed, ...rest } = current;
        void _removed;
        return rest;
      }
      return { ...current, [selectedId]: next };
    });
  }

  function addFiles(files: File[]) {
    if (!files.length) return;
    const available = MAX_ATTACHMENTS - pendingAttachments.length;
    if (available <= 0 || files.length > available) {
      setError(`每条消息最多添加 ${MAX_ATTACHMENTS} 个图片或文件。`);
      return;
    }
    const nextFiles = [...pendingAttachments.map((item) => item.file), ...files];
    if (nextFiles.reduce((total, file) => total + file.size, 0) > MAX_BATCH_SIZE) {
      setError("一条消息的附件总大小不能超过 50MB。");
      return;
    }
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = file.type.startsWith("image/");
      if (BLOCKED_EXTENSIONS.has(extension)) {
        setError(`不允许发送可执行文件或脚本：${file.name}`);
        return;
      }
      if (isImage && file.size > MAX_IMAGE_SIZE) {
        setError(`单张图片不能超过 8MB：${file.name}`);
        return;
      }
      if (!isImage && file.size > MAX_FILE_SIZE) {
        setError(`单个普通文件不能超过 20MB：${file.name}`);
        return;
      }
    }
    setPendingAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${Date.now()}-${crypto.randomUUID()}`,
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })),
    ]);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length) addFiles(files);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    const socket = socketRef.current;
    const token = readAccessToken();
    if ((!body && !pendingAttachments.length) || !selectedId || !token) return;
    if (!socket?.connected) {
      setError("聊天连接尚未建立，请稍后重试。");
      return;
    }
    setIsSending(true);
    try {
      const attachments = pendingAttachments.length
        ? await uploadChatAttachments(token, selectedId, pendingAttachments.map((item) => item.file))
        : [];
      const response = await socket.timeout(10000).emitWithAck("chat:send", {
        conversationId: selectedId,
        body,
        attachmentIds: attachments.map((item) => item.id),
      }) as ChatAck;
      if (!response.ok) throw new Error(response.error || "消息发送失败。");
      updateDraft("");
      pendingAttachments.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      setPendingAttachments([]);
      setIsEmojiOpen(false);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "消息发送失败，请重试。");
    } finally {
      setIsSending(false);
    }
  }

  async function sendQuickMessage(body: string) {
    const socket = socketRef.current;
    if (!selected || !socket?.connected || isSending) return;
    setIsSending(true);
    try {
      const response = await socket.timeout(10000).emitWithAck("chat:send", {
        conversationId: selected.id,
        body,
        attachmentIds: [],
      }) as ChatAck;
      if (!response.ok) throw new Error(response.error || "消息发送失败。");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "消息发送失败，请重试。");
    } finally {
      setIsSending(false);
    }
  }

  async function handleFriendRequest(friendship: Friendship, status: "accepted" | "declined") {
    const token = readAccessToken();
    if (!token) return;
    try {
      await respondFriendRequest(token, friendship.id, status);
      const [friendshipResult, notificationResult] = await Promise.all([
        listFriendships(token),
        listNotifications(token),
      ]);
      setFriendships(friendshipResult);
      setNotifications(notificationResult.items);
      if (status === "accepted") {
        const conversation = await getOrCreateConversation(token, friendship.user.id);
        setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
        setSelectedId(conversation.id);
        setActiveTab("chats");
        setIsMobileConversationOpen(true);
      }
      setNotice(status === "accepted" ? "已成为好友。" : "已拒绝好友申请。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "好友申请处理失败。");
    }
  }

  async function openFriendChat(friendship: Friendship) {
    const token = readAccessToken();
    if (!token) return;
    try {
      const conversation = await getOrCreateConversation(token, friendship.user.id);
      setConversations((current) => current.some((item) => item.id === conversation.id)
        ? current
        : [conversation, ...current]);
      setSelectedId(conversation.id);
      setActiveTab("chats");
      setIsMobileConversationOpen(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "会话创建失败。");
    }
  }

  async function handleNotification(notification: SocialNotification) {
    const token = readAccessToken();
    if (!token) return;
    if (!notification.readAt) {
      try {
        await markNotificationRead(token, notification.id);
        setNotifications((current) => current.map((item) =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item,
        ));
        notifySocialStateChange();
      } catch {
        // Following the action is still useful if read-state persistence fails.
      }
    }
    if (notification.type === "friend_request_received") {
      setActiveTab("friends");
      setIsMobileConversationOpen(false);
      return;
    }
    setSelectedId(SYSTEM_CONVERSATION_ID);
    setSelectedSystemNotificationId(notification.id);
    setActiveTab("chats");
    setIsMobileConversationOpen(true);
  }

  async function readAllNotifications() {
    const token = readAccessToken();
    if (!token) return;
    try {
      await markAllNotificationsRead(token);
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "通知状态更新失败。");
    }
  }

  function closeDock() {
    setIsOpen(false);
    setIsMinimized(false);
    setIsEmojiOpen(false);
    setPreviewAttachment(null);
  }

  function beginDockDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!isDesktop || !dockGeometry || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const start = { clientX: event.clientX, clientY: event.clientY, geometry: dockGeometry };
    trackDockPointer(
      (pointerEvent) => setDockGeometry(clampDockGeometry({
        ...start.geometry,
        x: start.geometry.x + pointerEvent.clientX - start.clientX,
        y: start.geometry.y + pointerEvent.clientY - start.clientY,
      })),
    );
  }

  function beginDockResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isDesktop || !dockGeometry || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { clientX: event.clientX, clientY: event.clientY, geometry: dockGeometry };
    trackDockPointer(
      (pointerEvent) => setDockGeometry(clampDockGeometry({
        ...start.geometry,
        width: start.geometry.width + pointerEvent.clientX - start.clientX,
        height: start.geometry.height + pointerEvent.clientY - start.clientY,
      })),
    );
  }

  const dockStyle: CSSProperties | undefined = isDesktop && dockGeometry ? {
    left: dockGeometry.x,
    top: dockGeometry.y,
    right: "auto",
    bottom: "auto",
    width: dockGeometry.width,
    height: dockGeometry.height,
  } : undefined;

  const minimizedStyle: CSSProperties | undefined = isDesktop && dockGeometry ? {
    left: Math.min(window.innerWidth - 58, dockGeometry.x + dockGeometry.width - 48),
    top: Math.min(window.innerHeight - 58, dockGeometry.y + dockGeometry.height - 48),
    right: "auto",
    bottom: "auto",
  } : undefined;

  if (!user || !isOpen) return null;

  if (isMinimized) {
    return <>
      <button aria-label="展开聊天窗" className="chat-dock-minimized" onClick={() => setIsMinimized(false)} style={minimizedStyle} title="展开聊天" type="button">
        <MessageCircleMore aria-hidden="true" size={23} />
        {dockUnreadCount ? <b>{formatCount(dockUnreadCount)}</b> : null}
      </button>
      <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </>;
  }

  return (
    <>
      <section className={`chat-dock${isMobileConversationOpen ? " mobile-conversation-open" : ""}`} aria-label="消息与聊天" style={dockStyle}>
        <header className="chat-dock-titlebar" onPointerDown={beginDockDrag}>
          <button
            aria-label="返回消息列表"
            className="chat-mobile-back"
            onClick={() => setIsMobileConversationOpen(false)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={19} />
          </button>
          <span><MessageCircleMore aria-hidden="true" size={18} /><strong>{isSystemSelected ? "系统消息" : selected?.user.nickname ?? "消息"}</strong></span>
          <div>
            <button aria-label="最小化聊天窗" onClick={() => setIsMinimized(true)} type="button"><Minus aria-hidden="true" size={17} /></button>
            <button aria-label="关闭聊天窗" onClick={closeDock} type="button"><X aria-hidden="true" size={17} /></button>
          </div>
        </header>
        <div className={`chat-dock-body${isMobileConversationOpen ? " mobile-conversation-open" : ""}`}>
          <aside className="chat-dock-sidebar">
            <div className="chat-dock-tabs" role="tablist">
              <button aria-label="会话" className={activeTab === "chats" ? "active" : ""} onClick={() => setActiveTab("chats")} title="会话" type="button"><MessageCircle aria-hidden="true" size={18} />{unreadMessages ? <b>{formatCount(unreadMessages)}</b> : null}</button>
              <button aria-label="好友" className={activeTab === "friends" ? "active" : ""} onClick={() => setActiveTab("friends")} title="好友" type="button"><Users aria-hidden="true" size={18} />{friendships.incoming.length ? <b>{formatCount(friendships.incoming.length)}</b> : null}</button>
            </div>
            <div className="chat-dock-sidebar-content">
              {isLoading ? <span className="chat-state">正在读取。</span> : null}
              {activeTab === "chats" ? <div className="conversation-list">
                <button className={isSystemSelected ? "active system-conversation" : "system-conversation"} onClick={() => { setSelectedId(SYSTEM_CONVERSATION_ID); setSelectedSystemNotificationId(0); setIsMobileConversationOpen(true); }} type="button">
                  <span className="chat-system-avatar"><Bell aria-hidden="true" size={17} /></span>
                  <span><strong>系统消息</strong><small>{systemNotifications[0]?.body ?? "通知会集中显示在这里"}</small></span>
                  {unreadNotifications ? <b>{formatCount(unreadNotifications)}</b> : null}
                </button>
                {conversations.map((conversation) => (
                  <button className={conversation.id === selectedId ? "active" : undefined} key={conversation.id} onClick={() => { setSelectedId(conversation.id); setIsMobileConversationOpen(true); }} type="button">
                    <UserAvatar user={conversation.user} />
                    <span><strong className="chat-conversation-name">{conversation.user.nickname}<RoleSymbol code={conversation.user.isSuperAdmin ? "super_administrator" : conversation.user.role.code} /></strong><small>{getConversationPreview(conversation)}</small></span>
                    {conversation.unreadCount ? <b>{formatCount(conversation.unreadCount)}</b> : null}
                  </button>
                ))}
              </div> : null}
              {activeTab === "friends" ? <div className="chat-friendship-pane">
                {friendships.incoming.length ? <section className="friend-request-list"><h2><UserPlus aria-hidden="true" size={15} />好友申请</h2>{friendships.incoming.map((friendship) => (
                  <div className="friend-request-card" key={friendship.id}>
                    <UserAvatar user={friendship.user} />
                    <span><strong>{friendship.user.nickname}</strong><small>@{friendship.user.username}</small></span>
                    {friendship.note ? <p>{friendship.note}</p> : null}
                    <div><button onClick={() => void handleFriendRequest(friendship, "accepted")} title="接受" type="button"><Check aria-hidden="true" size={15} />接受</button><button onClick={() => void handleFriendRequest(friendship, "declined")} title="拒绝" type="button"><X aria-hidden="true" size={15} />拒绝</button></div>
                  </div>
                ))}</section> : null}
                <section className="friend-contact-list"><h2>好友</h2>{friendships.friends.length ? friendships.friends.map((friendship) => (
                  <button key={friendship.id} onClick={() => void openFriendChat(friendship)} type="button"><UserAvatar user={friendship.user} /><span><strong>{friendship.user.nickname}</strong><small>@{friendship.user.username}</small></span><MessageCircle aria-hidden="true" size={15} /></button>
                )) : <span className="chat-sidebar-empty">还没有好友。</span>}</section>
              </div> : null}
            </div>
          </aside>
          <main className={`chat-panel${isSystemSelected ? " system-selected" : ""}`}>
            {isSystemSelected ? <SystemNotificationPanel
              notifications={systemNotifications}
              onMarkAllRead={readAllNotifications}
              onOpenArticle={(slug) => router.push(`/articles/${slug}`)}
              onSelect={handleNotification}
              selectedId={selectedSystemNotificationId}
              unreadCount={unreadNotifications}
              listRef={systemMessageListRef}
            /> : selected ? <>
              <div className="chat-message-list" ref={messageListRef}>
                {hasMore ? <button className="chat-load-older" onClick={() => void loadOlderMessages()} type="button"><ChevronUp aria-hidden="true" size={14} />更早消息</button> : null}
                {isMessagesLoading ? <span className="chat-state">正在读取聊天记录。</span> : messages.map((message) => (
                  <ChatMessageItem key={message.id} message={message} mine={message.sender.id === user.id} onGreeting={() => void sendQuickMessage("你好")} onPreview={setPreviewAttachment} />
                ))}
              </div>
              <form className="chat-composer" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} onSubmit={sendMessage}>
                {pendingAttachments.length ? <div className="chat-pending-attachments">{pendingAttachments.map((attachment) => (
                  <span key={attachment.id}>{attachment.previewUrl ? <img alt="" src={attachment.previewUrl} /> : <FileText aria-hidden="true" size={22} />}<small title={attachment.file.name}>{attachment.file.name}</small><button aria-label={`移除 ${attachment.file.name}`} onClick={() => removePendingAttachment(attachment.id)} type="button"><X aria-hidden="true" size={13} /></button></span>
                ))}</div> : null}
                <div className="chat-composer-row">
                  <input accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.json,.xml,.rtf,.zip,.rar,.7z,.gz,.tar" hidden multiple onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} ref={fileInputRef} type="file" />
                  <div className="chat-composer-tools">
                    <button aria-label="添加表情" className={isEmojiOpen ? "active" : ""} onClick={() => setIsEmojiOpen((current) => !current)} title="表情" type="button"><Laugh aria-hidden="true" size={18} /></button>
                    <button aria-label="添加图片或文件" onClick={() => fileInputRef.current?.click()} title="添加图片或文件" type="button"><Paperclip aria-hidden="true" size={18} /></button>
                  </div>
                  <textarea aria-label={`给 ${selected.user.nickname} 发消息`} maxLength={2000} onChange={(event) => updateDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} onPaste={handlePaste} placeholder="输入消息" rows={2} value={draft} />
                  <button aria-label="发送消息" disabled={isSending || (!draft.trim() && !pendingAttachments.length)} title="发送消息" type="submit">{isSending ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : <Send aria-hidden="true" size={18} />}</button>
                </div>
                {isEmojiOpen ? <div className="chat-emoji-picker">{EMOJIS.map((emoji) => <button key={emoji} onClick={() => { updateDraft(`${draft}${emoji}`); setIsEmojiOpen(false); }} type="button">{emoji}</button>)}</div> : null}
              </form>
            </> : <div className="chat-empty"><MessageCircle aria-hidden="true" size={28} /><strong>选择一位好友开始聊天</strong><span>可以发送文字、表情、图片和文件。</span></div>}
          </main>
        </div>
        <button aria-label="调整聊天窗大小" className="chat-dock-resize-handle" onPointerDown={beginDockResize} tabIndex={-1} type="button" />
      </section>
      {previewAttachment ? <AttachmentPreview attachment={previewAttachment} onClose={closeAttachmentPreview} /> : null}
      <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </>
  );
}

function SystemNotificationPanel({ notifications, selectedId, unreadCount, listRef, onMarkAllRead, onOpenArticle, onSelect }: {
  notifications: SocialNotification[];
  selectedId: number;
  unreadCount: number;
  listRef: RefObject<HTMLDivElement | null>;
  onMarkAllRead: () => Promise<void>;
  onOpenArticle: (slug: string) => void;
  onSelect: (notification: SocialNotification) => Promise<void>;
}) {
  return <div className="chat-system-panel">
    {unreadCount ? <button className="chat-read-all" onClick={() => void onMarkAllRead()} type="button">全部标为已读</button> : null}
    <div className="chat-system-message-list" ref={listRef}>
      {notifications.length ? notifications.map((notification) => (
        <article className={`${notification.readAt ? "" : "unread"}${selectedId === notification.id ? " selected" : ""}`} data-notification-id={notification.id} key={notification.id}>
          <button className="chat-system-notification-main" onClick={() => void onSelect(notification)} type="button">
            <span className="chat-system-notification-icon"><Bell aria-hidden="true" size={17} /></span>
            <span>
              <strong>{notification.title}</strong>
              <small>{notification.body}</small>
              {notification.context?.kind === "comment_report" ? <q>{notification.context.commentBody}</q> : null}
              <time>{formatChatTime(notification.createdAt)}</time>
            </span>
          </button>
          {notification.context?.kind === "comment_report" ? <button className="chat-system-article-link" onClick={() => onOpenArticle(notification.context!.article.slug)} type="button"><FileText aria-hidden="true" size={15} /><span><small>相关文章</small><strong>{notification.context.article.title}</strong></span><ChevronLeft aria-hidden="true" size={15} /></button> : null}
        </article>
      )) : <div className="chat-empty"><Bell aria-hidden="true" size={26} /><strong>暂时没有系统消息</strong><span>好友申请结果和内容处理通知会显示在这里。</span></div>}
    </div>
  </div>;
}

function ChatMessageItem({ message, mine, onGreeting, onPreview }: { message: ChatMessage; mine: boolean; onGreeting: () => void; onPreview: (attachment: ChatAttachment) => void }) {
  if (message.type === "system") {
    return <div className="chat-system-row">
      <span>{message.body}</span>
      <button onClick={onGreeting} type="button">打个招呼</button>
      <time>{formatChatTime(message.createdAt)}</time>
    </div>;
  }
  const emojiOnly = isEmojiOnly(message.body);
  return <div className={`chat-message ${mine ? "mine" : "theirs"}${emojiOnly ? " emoji-only" : ""}`}>
    <UserAvatar user={message.sender} />
    <div>
      {message.attachments?.length ? <div className={`chat-message-attachments count-${Math.min(message.attachments.length, 4)}`}>{message.attachments.map((attachment) => attachment.kind === "image"
        ? <AuthenticatedImage attachment={attachment} key={attachment.id} onClick={() => onPreview(attachment)} />
        : <AttachmentFile attachment={attachment} key={attachment.id} />)}</div> : null}
      {message.body ? <p>{message.body}</p> : null}
      <span>{formatChatTime(message.createdAt)}{mine ? ` · ${message.readAt ? "已读" : "未读"}` : ""}</span>
    </div>
  </div>;
}

function AuthenticatedImage({ attachment, onClick }: { attachment: ChatAttachment; onClick: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    let objectUrl = "";
    downloadChatAttachment(token, attachment)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);
  return <button className="chat-image-attachment" disabled={!url} onClick={onClick} type="button">{url ? <img alt={attachment.originalName} src={url} /> : <ImageIcon aria-hidden="true" size={22} />}</button>;
}

function AttachmentFile({ attachment }: { attachment: ChatAttachment }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    const token = readAccessToken();
    if (!token || isDownloading) return;
    setIsDownloading(true);
    try {
      const blob = await downloadChatAttachment(token, attachment);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.originalName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "附件下载失败。");
    } finally {
      setIsDownloading(false);
    }
  }
  return <><button className="chat-file-attachment" onClick={() => void download()} type="button"><FileText aria-hidden="true" size={22} /><span><strong title={attachment.originalName}>{attachment.originalName}</strong><small>{formatFileSize(attachment.sizeBytes)}</small></span>{isDownloading ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Download aria-hidden="true" size={16} />}</button><AppToast duration={4200} message={error} onDismiss={() => setError("")} tone="error" /></>;
}

function AttachmentPreview({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    let objectUrl = "";
    downloadChatAttachment(token, attachment).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => onClose());
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment, onClose]);
  return <div className="chat-attachment-preview" onClick={onClose} role="presentation"><button aria-label="关闭图片预览" onClick={onClose} type="button"><X aria-hidden="true" size={22} /></button>{url ? <img alt={attachment.originalName} onClick={(event) => event.stopPropagation()} src={url} /> : <LoaderCircle aria-hidden="true" className="spin" size={26} />}</div>;
}

function UserAvatar({ user, large = false }: { user: SocialUser; large?: boolean }) {
  const avatar = user.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  return <span className={`chat-user-avatar${large ? " large" : ""}`}>{avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText(user)}</span>;
}

function getConversationPreview(conversation: Conversation): string {
  if (!conversation.lastMessage) return "开始聊天";
  if (conversation.lastMessage.body) return conversation.lastMessage.body;
  const count = conversation.lastMessage.attachments?.length ?? 0;
  return count ? `[${count} 个附件]` : "新消息";
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

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function isEmojiOnly(value: string): boolean {
  if (!value.trim()) return false;
  return value.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u200D\uFE0F\s]/gu, "").length === 0;
}

function getDefaultDockGeometry(): DockGeometry {
  const width = Math.min(760, window.innerWidth - 36);
  const height = Math.min(610, window.innerHeight - 92);
  return { x: window.innerWidth - width - 18, y: window.innerHeight - height - 18, width, height };
}

function readDockGeometry(): DockGeometry | null {
  try {
    const value = window.localStorage.getItem(DOCK_GEOMETRY_STORAGE_KEY);
    return value ? JSON.parse(value) as DockGeometry : null;
  } catch {
    return null;
  }
}

function clampDockGeometry(value: DockGeometry): DockGeometry {
  const margin = 12;
  const width = Math.min(Math.max(value.width, 520), window.innerWidth - margin * 2);
  const height = Math.min(Math.max(value.height, 380), window.innerHeight - margin * 2);
  return {
    width,
    height,
    x: Math.min(Math.max(value.x, margin), window.innerWidth - width - margin),
    y: Math.min(Math.max(value.y, margin), window.innerHeight - height - margin),
  };
}

function trackDockPointer(onMove: (event: PointerEvent) => void) {
  const previousUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = "none";
  function finish() {
    document.body.style.userSelect = previousUserSelect;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
}
