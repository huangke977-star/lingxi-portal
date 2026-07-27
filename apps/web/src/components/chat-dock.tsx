"use client";

/* eslint-disable @next/next/no-img-element */

import {
  FileAudio,
  Ban,
  Bell,
  Check,
  ChevronLeft,
  ChevronUp,
  Download,
  Eraser,
  FileText,
  FileVideo,
  Heart,
  Image as ImageIcon,
  Laugh,
  LoaderCircle,
  Mic,
  MessageCircle,
  MessageCircleMore,
  Minus,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Rss,
  Search,
  Send,
  ShieldOff,
  Square,
  Trash2,
  Undo2,
  UserMinus,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
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
import { ChatCallPanel, useChatCalls } from "@/components/chat-call";
import { RoleSymbol } from "@/components/role-symbol";
import { getMe, refreshStoredSession, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  readAccessToken,
} from "@/lib/auth-storage";
import {
  type ChatAttachment,
  type ChatMessage,
  type CallSession,
  type Conversation,
  type Friendship,
  type SocialNotification,
  type SocialUserSearchResult,
  type SocialUser,
  type NotificationChannel,
  blockFriendship,
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
  removeFriendship,
  requestFriend,
  respondFriendRequest,
  searchSocialUsers,
  unblockFriendship,
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
const NOTIFICATION_CHANNELS = [
  { channel: "system", id: -1, label: "系统消息", empty: "好友申请结果和内容处理通知会显示在这里。" },
  { channel: "subscription", id: -2, label: "订阅更新", empty: "订阅作者发布的新内容会显示在这里。" },
  { channel: "interaction", id: -3, label: "互动消息", empty: "点赞、收藏、评论和新订阅会显示在这里。" },
] as const satisfies ReadonlyArray<{ channel: NotificationChannel; id: number; label: string; empty: string }>;
const DOCK_GEOMETRY_STORAGE_KEY = "hlovet-chat-dock-geometry";
const DOCK_ICON_POSITION_STORAGE_KEY = "hlovet-chat-dock-icon-position";
const DOCK_ICON_SIZE = 48;
const DOCK_EDGE_MARGIN = 12;
const DOCK_ICON_GAP = 10;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_AUDIO_SIZE = 20 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_BATCH_SIZE = 50 * 1024 * 1024;
const MAX_VOICE_RECORDING_SECONDS = 5 * 60;
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

interface ChatMutationAck {
  ok: boolean;
  error?: string;
}

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
  kind: "image" | "audio" | "video" | "file";
}

interface DockGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DockIconPosition {
  x: number;
  y: number;
}

interface PendingFriendAction {
  friendship: Friendship;
  action: "remove" | "block";
}

type ConversationAction = "clear" | "delete";
type MessageDeleteMode = "self" | "everyone";
type MessageOperation = "delete-self" | "delete-everyone" | "recall";

export function ChatDock() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const discardVoiceRecordingRef = useRef(false);
  const voiceTimerRef = useRef<number | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const systemMessageListRef = useRef<HTMLDivElement | null>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const selectedIdRef = useRef(0);
  const sessionUserIdRef = useRef(0);
  const openRef = useRef(false);
  const minimizedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const iconDraggedRef = useRef(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [chatSocket, setChatSocket] = useState<Socket | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friendships, setFriendships] = useState<{
    friends: Friendship[];
    incoming: Friendship[];
    outgoing: Friendship[];
    blocked: Friendship[];
  }>({ friends: [], incoming: [], outgoing: [], blocked: [] });
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
  const [dockIconPosition, setDockIconPosition] = useState<DockIconPosition | null>(null);
  const [isMobileConversationOpen, setIsMobileConversationOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] = useState(0);
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [isMobileToolsOpen, setIsMobileToolsOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const [openFriendActionId, setOpenFriendActionId] = useState(0);
  const [pendingFriendAction, setPendingFriendAction] = useState<PendingFriendAction | null>(null);
  const [isFriendActionRunning, setIsFriendActionRunning] = useState(false);
  const [friendSearch, setFriendSearch] = useState("");
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<SocialUserSearchResult[]>([]);
  const [isUserSearching, setIsUserSearching] = useState(false);
  const [friendRequestTarget, setFriendRequestTarget] = useState<SocialUserSearchResult | null>(null);
  const [friendRequestNote, setFriendRequestNote] = useState("");
  const [isFriendRequestSending, setIsFriendRequestSending] = useState(false);
  const [isConversationMenuOpen, setIsConversationMenuOpen] = useState(false);
  const [pendingConversationAction, setPendingConversationAction] = useState<ConversationAction | null>(null);
  const [isConversationActionRunning, setIsConversationActionRunning] = useState(false);
  const [openMessageActionId, setOpenMessageActionId] = useState(0);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(new Set());
  const [isMessageSelectionMode, setIsMessageSelectionMode] = useState(false);
  const [isMessageActionRunning, setIsMessageActionRunning] = useState(false);
  const [pendingMessageOperation, setPendingMessageOperation] = useState<{
    operation: MessageOperation;
    messageIds: number[];
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const channelNotifications = useMemo(
    () => ({
      system: notifications.filter((item) => item.channel === "system" && item.type !== "friend_request_received"),
      subscription: notifications.filter((item) => item.channel === "subscription"),
      interaction: notifications.filter((item) => item.channel === "interaction"),
    }),
    [notifications],
  );
  const friendshipByUserId = useMemo(
    () => new Map(friendships.friends.map((friendship) => [friendship.user.id, friendship])),
    [friendships.friends],
  );
  const conversationUserIds = useMemo(
    () => new Set(conversations.map((conversation) => conversation.user.id)),
    [conversations],
  );
  const friendsWithoutConversation = useMemo(
    () => friendships.friends.filter((friendship) => !conversationUserIds.has(friendship.user.id)),
    [conversationUserIds, friendships.friends],
  );
  const normalizedFriendSearch = friendSearch.trim().toLocaleLowerCase();
  const matchesFriendSearch = useCallback((target: SocialUser) => {
    if (!normalizedFriendSearch) return true;
    return target.nickname.toLocaleLowerCase().includes(normalizedFriendSearch) ||
      target.username.toLocaleLowerCase().includes(normalizedFriendSearch);
  }, [normalizedFriendSearch]);
  const filteredFriendsWithoutConversation = useMemo(
    () => friendsWithoutConversation.filter((friendship) => matchesFriendSearch(friendship.user)),
    [friendsWithoutConversation, matchesFriendSearch],
  );
  const selectedNotificationConfig = NOTIFICATION_CHANNELS.find((item) => item.id === selectedId) ?? null;
  const selectedNotifications = selectedNotificationConfig ? channelNotifications[selectedNotificationConfig.channel] : [];
  const isNotificationSelected = Boolean(selectedNotificationConfig);
  const draft = selectedId ? drafts[selectedId] ?? "" : "";
  const pendingAttachments = selectedId ? pendingAttachmentsByConversation[selectedId] ?? [] : [];
  const unreadMessages = conversations.reduce((total, item) => total + item.unreadCount, 0);
  const unreadNotifications = notifications.filter((item) => item.type !== "friend_request_received" && !item.readAt).length;
  const selectedUnreadNotifications = selectedNotifications.filter((item) => !item.readAt).length;
  const dockUnreadCount = unreadMessages + unreadNotifications + friendships.incoming.length;
  const primaryEntries = useMemo(() => [
    ...conversations.filter((conversation) => matchesFriendSearch(conversation.user)).map((conversation) => ({ kind: "conversation" as const, id: conversation.id, activityAt: conversation.lastMessage?.createdAt ?? conversation.updatedAt, conversation })),
    ...(!normalizedFriendSearch ? NOTIFICATION_CHANNELS.map((config) => ({ kind: "notification" as const, id: config.id, activityAt: channelNotifications[config.channel][0]?.updatedAt ?? channelNotifications[config.channel][0]?.createdAt ?? "", config })) : []),
  ].sort((left, right) => timestamp(right.activityAt) - timestamp(left.activityAt)), [channelNotifications, conversations, matchesFriendSearch, normalizedFriendSearch]);
  const userId = user?.id ?? 0;
  const closeAttachmentPreview = useCallback(() => setPreviewAttachment(null), []);
  const handleIncomingCall = useCallback((call: CallSession) => {
    discardVoiceRecordingRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsOpen(true);
    setIsMinimized(false);
    setSelectedId(call.conversationId);
    setIsMobileConversationOpen(true);
  }, []);
  const handleCallError = useCallback((message: string) => setError(message), []);
  const handleCallNotice = useCallback((message: string) => setNotice(message), []);
  const chatCalls = useChatCalls({
    socket: chatSocket,
    userId,
    selected,
    onIncoming: handleIncomingCall,
    onError: handleCallError,
    onNotice: handleCallNotice,
  });
  const clearActiveCall = chatCalls.clearCall;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    openRef.current = isOpen;
    minimizedRef.current = isMinimized;
  }, [isMinimized, isOpen]);

  useEffect(() => {
    if (!isAddFriendOpen || userSearch.trim().length < 2) {
      setUserSearchResults([]);
      setIsUserSearching(false);
      return;
    }
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setIsUserSearching(true);
      searchSocialUsers(token, userSearch.trim())
        .then((result) => {
          if (active) setUserSearchResults(result.items);
        })
        .catch((searchError) => {
          if (active) setError(searchError instanceof Error ? searchError.message : "用户搜索失败。");
        })
        .finally(() => {
          if (active) setIsUserSearching(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isAddFriendOpen, userSearch]);

  useEffect(() => {
    function synchronizeGeometry() {
      const desktop = window.innerWidth > 760;
      setIsDesktop(desktop);
      if (!desktop) return;
      setDockGeometry((current) => clampDockGeometry(
        current ?? readDockGeometry() ?? getDefaultDockGeometry(),
      ));
      setDockIconPosition((current) => clampDockIconPosition(
        current ?? readDockIconPosition() ?? getDefaultDockIconPosition(),
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

  useEffect(() => {
    if (!isDesktop || !dockIconPosition) return;
    window.localStorage.setItem(DOCK_ICON_POSITION_STORAGE_KEY, JSON.stringify(dockIconPosition));
  }, [dockIconPosition, isDesktop]);

  const refreshSocialData = useCallback(async (showLoading = false) => {
    const token = readAccessToken();
    if (!token) {
      clearActiveCall();
      discardVoiceRecordingRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      pendingAttachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      sessionUserIdRef.current = 0;
      setUser(null);
      setConversations([]);
      setFriendships({ friends: [], incoming: [], outgoing: [], blocked: [] });
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
        if (NOTIFICATION_CHANNELS.some((item) => item.id === current)) return current;
        if (current && conversationResult.items.some((item) => item.id === current)) return current;
        return defaultPrimaryId(conversationResult.items, notificationResult.items);
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "消息数据加载失败。");
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [clearActiveCall]);

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
      if (detail.tab === "friends") setIsMobileConversationOpen(false);
      if (detail.systemNotificationId) {
        setSelectedId(notificationConversationId(detail.notificationChannel ?? "system"));
        setSelectedSystemNotificationId(detail.systemNotificationId);
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
    if (!isNotificationSelected || !selectedSystemNotificationId || !isOpen || isMinimized) return;
    window.requestAnimationFrame(() => {
      const item = systemMessageListRef.current?.querySelector<HTMLElement>(
        `[data-notification-id="${selectedSystemNotificationId}"]`,
      );
      item?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [isMinimized, isNotificationSelected, isOpen, selectedSystemNotificationId]);

  useEffect(() => {
    if (!openFriendActionId) return;
    function handlePointerDown(event: PointerEvent) {
      if ((event.target as HTMLElement).closest("[data-chat-friend-action]")) return;
      setOpenFriendActionId(0);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenFriendActionId(0);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openFriendActionId]);

  useEffect(() => {
    if (!isConversationMenuOpen && !openMessageActionId) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("[data-chat-conversation-action]") || target.closest("[data-chat-message-action]")) return;
      setIsConversationMenuOpen(false);
      setOpenMessageActionId(0);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsConversationMenuOpen(false);
      setOpenMessageActionId(0);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isConversationMenuOpen, openMessageActionId]);

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
    setChatSocket(socket);
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
    socket.on("chat:messages-deleted", (payload: { conversationId: number; messageIds: number[] }) => {
      if (payload.conversationId === selectedIdRef.current) {
        setMessages((current) => current.filter((message) => !payload.messageIds.includes(message.id)));
        setSelectedMessageIds((current) => {
          const next = new Set(current);
          payload.messageIds.forEach((messageId) => next.delete(messageId));
          return next;
        });
      }
      void refreshSocialData();
      notifySocialStateChange();
    });
    socket.on("chat:conversation-cleared", (payload: { conversationId: number }) => {
      if (payload.conversationId === selectedIdRef.current) setMessages([]);
      void refreshSocialData();
      notifySocialStateChange();
    });
    socket.on("chat:conversation-deleted", (payload: { conversationId: number }) => {
      setConversations((current) => current.filter((conversation) => conversation.id !== payload.conversationId));
      if (payload.conversationId === selectedIdRef.current) {
        setMessages([]);
        setSelectedId(0);
        setIsMobileConversationOpen(false);
      }
      void refreshSocialData();
      notifySocialStateChange();
    });
    socket.on("chat:error", (payload: { message?: string }) => setError(payload.message || "聊天连接出现问题。"));
    socket.on("chat:reauthenticate", () => {
      void (async () => {
        const session = await refreshStoredSession();
        const latestToken = session?.accessToken ?? readAccessToken();
        if (!latestToken) return;
        socket.auth = { token: latestToken };
        const response = await socket.timeout(10_000).emitWithAck("chat:authenticate", { token: latestToken }) as { ok?: boolean; error?: string };
        if (!response.ok) setError(response.error || "聊天连接重新认证失败。");
      })().catch(() => setError("聊天连接重新认证失败，请重新登录。"));
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
      setChatSocket((current) => current === socket ? null : current);
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

  useEffect(() => () => {
    discardVoiceRecordingRef.current = true;
    if (voiceTimerRef.current !== null) window.clearInterval(voiceTimerRef.current);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
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

  function clearVoiceTimer() {
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  function releaseVoiceStream() {
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }

  function cancelActiveVoiceRecording(discard: boolean) {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    discardVoiceRecordingRef.current = discard;
    if (recorder.state !== "inactive") recorder.stop();
    else {
      clearVoiceTimer();
      releaseVoiceStream();
      mediaRecorderRef.current = null;
      setIsVoiceRecording(false);
      setVoiceRecordingSeconds(0);
    }
  }

  async function startVoiceRecording() {
    if (!selectedId || isVoiceRecording || chatCalls.state || chatCalls.isPreparing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持语音录制。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      discardVoiceRecordingRef.current = false;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        discardVoiceRecordingRef.current = true;
        setError("语音录制失败，请重试。");
      };
      recorder.onstop = () => {
        clearVoiceTimer();
        releaseVoiceStream();
        mediaRecorderRef.current = null;
        setIsVoiceRecording(false);
        setVoiceRecordingSeconds(0);
        if (discardVoiceRecordingRef.current) {
          voiceChunksRef.current = [];
          return;
        }
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        voiceChunksRef.current = [];
        if (!blob.size) {
          setError("没有录到有效的语音内容。");
          return;
        }
        const extension = blob.type.includes("mp4") ? "m4a" : "webm";
        addFiles([new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type })]);
      };
      recorder.start(1000);
      setIsVoiceRecording(true);
      setVoiceRecordingSeconds(0);
      const startedAt = Date.now();
      voiceTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setVoiceRecordingSeconds(elapsed);
        if (elapsed >= MAX_VOICE_RECORDING_SECONDS) cancelActiveVoiceRecording(false);
      }, 250);
    } catch (recordError) {
      releaseVoiceStream();
      setError(recordError instanceof Error ? recordError.message : "无法使用麦克风。");
    }
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
      const isAudio = file.type.startsWith("audio/");
      const isVideo = file.type.startsWith("video/");
      if (BLOCKED_EXTENSIONS.has(extension)) {
        setError(`不允许发送可执行文件或脚本：${file.name}`);
        return;
      }
      if (isImage && file.size > MAX_IMAGE_SIZE) {
        setError(`单张图片不能超过 8MB：${file.name}`);
        return;
      }
      if (isAudio && file.size > MAX_AUDIO_SIZE) {
        setError(`单个音频不能超过 20MB：${file.name}`);
        return;
      }
      if (isVideo && file.size > MAX_VIDEO_SIZE) {
        setError(`单个视频不能超过 50MB：${file.name}`);
        return;
      }
      if (!isImage && !isAudio && !isVideo && file.size > MAX_FILE_SIZE) {
        setError(`单个普通文件不能超过 20MB：${file.name}`);
        return;
      }
    }
    setPendingAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${Date.now()}-${crypto.randomUUID()}`,
        file,
        previewUrl: /^(image|audio|video)\//.test(file.type) ? URL.createObjectURL(file) : null,
        kind: file.type.startsWith("image/")
          ? "image" as const
          : file.type.startsWith("audio/")
            ? "audio" as const
            : file.type.startsWith("video/")
              ? "video" as const
              : "file" as const,
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
      setIsMobileToolsOpen(false);
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
      setIsMobileConversationOpen(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "会话创建失败。");
    }
  }

  async function openSearchResultChat(target: SocialUserSearchResult) {
    const token = readAccessToken();
    if (!token) return;
    try {
      const conversation = await getOrCreateConversation(token, target.id);
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setSelectedId(conversation.id);
      setIsMobileConversationOpen(true);
      setIsAddFriendOpen(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "会话创建失败。");
    }
  }

  async function sendFriendRequest() {
    const token = readAccessToken();
    if (!token || !friendRequestTarget || isFriendRequestSending) return;
    setIsFriendRequestSending(true);
    try {
      const friendship = await requestFriend(token, friendRequestTarget.id, friendRequestNote.trim() || undefined);
      setUserSearchResults((current) => current.map((item) =>
        item.id === friendRequestTarget.id
          ? { ...item, relationship: { id: friendship.id, status: friendship.status, direction: friendship.direction, note: friendship.note }, canRequest: false }
          : item,
      ));
      setFriendRequestTarget(null);
      setFriendRequestNote("");
      await refreshSocialData();
      setNotice("好友申请已发送。");
      notifySocialStateChange();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "好友申请发送失败。");
    } finally {
      setIsFriendRequestSending(false);
    }
  }

  async function executeConversationAction() {
    const socket = socketRef.current;
    if (!selected || !pendingConversationAction || !socket?.connected || isConversationActionRunning) return;
    setIsConversationActionRunning(true);
    try {
      const event = pendingConversationAction === "clear"
        ? "chat:conversation:clear"
        : "chat:conversation:delete";
      const response = await socket.timeout(10_000).emitWithAck(event, {
        conversationId: selected.id,
      }) as ChatMutationAck;
      if (!response.ok) throw new Error(response.error || "聊天操作失败。");
      const completedAction = pendingConversationAction;
      setPendingConversationAction(null);
      setIsConversationMenuOpen(false);
      setMessages([]);
      if (completedAction === "delete") {
        setConversations((current) => current.filter((item) => item.id !== selected.id));
        setSelectedId(0);
        setIsMobileConversationOpen(false);
      }
      await refreshSocialData();
      setNotice(completedAction === "clear" ? "聊天记录已清空。" : "聊天已从当前列表删除，可通过好友搜索重新发起。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "聊天操作失败。");
    } finally {
      setIsConversationActionRunning(false);
    }
  }

  function beginMessageSelection(messageId: number) {
    setOpenMessageActionId(0);
    setIsMessageSelectionMode(true);
    setSelectedMessageIds(new Set([messageId]));
  }

  function toggleMessageSelection(messageId: number) {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function cancelMessageSelection() {
    setIsMessageSelectionMode(false);
    setSelectedMessageIds(new Set());
    setOpenMessageActionId(0);
  }

  async function executeMessageOperation() {
    const socket = socketRef.current;
    if (!pendingMessageOperation || !socket?.connected || isMessageActionRunning || !selected) return;
    setIsMessageActionRunning(true);
    try {
      const { operation, messageIds } = pendingMessageOperation;
      const response = operation === "recall"
        ? await socket.timeout(10_000).emitWithAck("chat:message:recall", { messageId: messageIds[0] }) as ChatMutationAck
        : await socket.timeout(10_000).emitWithAck(
            operation === "delete-everyone" ? "chat:messages:delete-everyone" : "chat:messages:delete-self",
            { conversationId: selected.id, messageIds },
          ) as ChatMutationAck;
      if (!response.ok) throw new Error(response.error || "消息操作失败。");
      setMessages((current) => current.filter((message) => !messageIds.includes(message.id)));
      const completedOperation = operation;
      setPendingMessageOperation(null);
      cancelMessageSelection();
      await refreshSocialData();
      setNotice(
        completedOperation === "recall"
          ? "消息已撤回。"
          : completedOperation === "delete-everyone"
            ? "消息已双向物理删除。"
            : "消息已从当前账号删除。",
      );
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "消息操作失败。");
    } finally {
      setIsMessageActionRunning(false);
    }
  }

  function requestSelectedMessageDeletion(mode: MessageDeleteMode) {
    const ids = Array.from(selectedMessageIds);
    if (!ids.length) return;
    setPendingMessageOperation({
      operation: mode === "everyone" ? "delete-everyone" : "delete-self",
      messageIds: ids,
    });
  }

  function callFromMessage(message: ChatMessage) {
    const callType = message.call?.type ?? inferCallType(message.body);
    if (!callType) return;
    if (!chatSocket?.connected) {
      setError("聊天连接尚未建立，暂时无法发起通话。");
      return;
    }
    void chatCalls.startCall(callType);
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
      setIsMobileConversationOpen(false);
      return;
    }
    setSelectedId(notificationConversationId(notification.channel));
    setSelectedSystemNotificationId(notification.id);
    setIsMobileConversationOpen(true);
    if (notification.channel !== "system" && notification.actionUrl) router.push(notification.actionUrl);
  }

  async function executeFriendAction() {
    const token = readAccessToken();
    if (!token || !pendingFriendAction || isFriendActionRunning) return;
    setIsFriendActionRunning(true);
    try {
      if (pendingFriendAction.action === "block") {
        await blockFriendship(token, pendingFriendAction.friendship.id);
      } else {
        await removeFriendship(token, pendingFriendAction.friendship.id);
      }
      const completedAction = pendingFriendAction.action;
      setPendingFriendAction(null);
      setOpenFriendActionId(0);
      await refreshSocialData();
      setNotice(completedAction === "block" ? "已拉黑该用户。" : "已删除好友。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "好友关系操作失败。");
    } finally {
      setIsFriendActionRunning(false);
    }
  }

  async function handleUnblock(friendship: Friendship) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await unblockFriendship(token, friendship.id);
      await refreshSocialData();
      setNotice("已解除拉黑，可以重新发送好友申请。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "解除拉黑失败。");
    }
  }

  async function readAllNotifications() {
    const token = readAccessToken();
    if (!token) return;
    try {
      if (!selectedNotificationConfig) return;
      await markAllNotificationsRead(token, selectedNotificationConfig.channel);
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => item.channel === selectedNotificationConfig.channel ? { ...item, readAt: item.readAt ?? readAt } : item));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "通知状态更新失败。");
    }
  }

  function closeDock() {
    setIsOpen(false);
    setIsMinimized(false);
    setIsEmojiOpen(false);
    setIsMobileToolsOpen(false);
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

  function beginIconDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isDesktop || !dockIconPosition || event.button !== 0) return;
    event.preventDefault();
    const start = { clientX: event.clientX, clientY: event.clientY, position: dockIconPosition };
    iconDraggedRef.current = false;
    trackDockPointer(
      (pointerEvent) => {
        const deltaX = pointerEvent.clientX - start.clientX;
        const deltaY = pointerEvent.clientY - start.clientY;
        if (Math.hypot(deltaX, deltaY) > 4) iconDraggedRef.current = true;
        setDockIconPosition(clampDockIconPosition({
          x: start.position.x + deltaX,
          y: start.position.y + deltaY,
        }));
      },
      () => window.setTimeout(() => { iconDraggedRef.current = false; }, 0),
    );
  }

  function expandFromIcon() {
    if (iconDraggedRef.current) return;
    if (isDesktop && dockIconPosition && dockGeometry) {
      setDockGeometry(placeDockBesideIcon(dockGeometry, dockIconPosition));
    }
    setIsMinimized(false);
  }

  const dockStyle: CSSProperties | undefined = isDesktop && dockGeometry ? {
    left: dockGeometry.x,
    top: dockGeometry.y,
    right: "auto",
    bottom: "auto",
    width: dockGeometry.width,
    height: dockGeometry.height,
  } : undefined;

  const minimizedStyle: CSSProperties | undefined = isDesktop && dockIconPosition ? {
    left: dockIconPosition.x,
    top: dockIconPosition.y,
    right: "auto",
    bottom: "auto",
  } : undefined;

  const callPanel = <ChatCallPanel
    isPreparing={chatCalls.isPreparing}
    localStream={chatCalls.localStream}
    onAccept={() => void chatCalls.acceptCall()}
    onDecline={chatCalls.declineCall}
    onEnd={chatCalls.endCall}
    onMinimize={chatCalls.setMinimized}
    onSwitchCamera={() => void chatCalls.switchCamera()}
    onToggleCamera={chatCalls.toggleCamera}
    onToggleMute={chatCalls.toggleMute}
    remoteStream={chatCalls.remoteStream}
    state={chatCalls.state}
  />;

  if (!user) return null;
  if (!isOpen) return callPanel;

  if (isMinimized) {
    return <>
      <button aria-label="展开聊天窗" className="chat-dock-minimized" onClick={expandFromIcon} onPointerDown={beginIconDrag} style={minimizedStyle} title="拖动调整位置，点击展开聊天" type="button">
        <MessageCircleMore aria-hidden="true" size={23} />
        {dockUnreadCount ? <b>{formatCount(dockUnreadCount)}</b> : null}
      </button>
      {callPanel}
      <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </>;
  }

  return (
    <>
      <section className={`chat-dock${isMobileConversationOpen ? " mobile-conversation-open" : ""}`} aria-label="消息与聊天" style={dockStyle}>
        <header className="chat-dock-titlebar" onPointerDown={beginDockDrag}>
          {!isDesktop && isMobileConversationOpen ? <button
              aria-label="返回消息列表"
              className="chat-mobile-back"
              onClick={() => setIsMobileConversationOpen(false)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={19} />
            </button> : null}
          <span><MessageCircleMore aria-hidden="true" size={18} /><strong>{selectedNotificationConfig?.label ?? selected?.user.nickname ?? "消息"}</strong></span>
          <div>
            {isDesktop || !isMobileConversationOpen ? <button aria-label="添加好友" onClick={() => { setIsAddFriendOpen(true); setUserSearch(""); setUserSearchResults([]); }} title="添加好友" type="button"><UserPlus aria-hidden="true" size={17} /></button> : null}
            {selected && (isDesktop || isMobileConversationOpen) ? <>
              <button aria-label="发起语音通话" disabled={isVoiceRecording || chatCalls.isPreparing || Boolean(chatCalls.state)} onClick={() => void chatCalls.startCall("voice")} title="语音通话" type="button"><Phone aria-hidden="true" size={17} /></button>
              <button aria-label="发起视频通话" disabled={isVoiceRecording || chatCalls.isPreparing || Boolean(chatCalls.state)} onClick={() => void chatCalls.startCall("video")} title="视频通话" type="button"><Video aria-hidden="true" size={17} /></button>
              {!isDesktop ? <span className="chat-conversation-action" data-chat-conversation-action>
                <button aria-expanded={isConversationMenuOpen} aria-label="聊天管理" onClick={() => setIsConversationMenuOpen((current) => !current)} title="聊天管理" type="button"><MoreHorizontal aria-hidden="true" size={17} /></button>
                {isConversationMenuOpen ? <span className="chat-conversation-action-menu">
                  <button onClick={() => setPendingConversationAction("clear")} type="button"><Eraser aria-hidden="true" size={15} />清空聊天</button>
                  <button className="danger" onClick={() => setPendingConversationAction("delete")} type="button"><Trash2 aria-hidden="true" size={15} />删除聊天</button>
                </span> : null}
              </span> : null}
            </> : null}
            <button aria-label="最小化聊天窗" onClick={() => setIsMinimized(true)} type="button"><Minus aria-hidden="true" size={17} /></button>
            <button aria-label="关闭聊天窗" onClick={closeDock} type="button"><X aria-hidden="true" size={17} /></button>
          </div>
        </header>
        <div className={`chat-dock-body${isMobileConversationOpen ? " mobile-conversation-open" : ""}`}>
          <aside className="chat-dock-sidebar">
            <div className="chat-dock-sidebar-content">
              <label className="chat-friend-search">
                <Search aria-hidden="true" size={15} />
                <input aria-label="搜索当前好友" onChange={(event) => setFriendSearch(event.target.value)} placeholder="搜索好友" value={friendSearch} />
                {friendSearch ? <button aria-label="清空好友搜索" onClick={() => setFriendSearch("")} type="button"><X aria-hidden="true" size={13} /></button> : null}
              </label>
              {isLoading ? <span className="chat-state">正在读取。</span> : null}
              <div className="chat-unified-list">
                {primaryEntries.map((entry) => entry.kind === "notification" ? (() => {
                  const items = channelNotifications[entry.config.channel];
                  const unreadCount = items.filter((item) => !item.readAt).length;
                  return <button className={selectedId === entry.id ? "chat-sidebar-primary-row active system-conversation" : "chat-sidebar-primary-row system-conversation"} key={entry.id} onClick={() => { setSelectedId(entry.id); setSelectedSystemNotificationId(0); setIsMobileConversationOpen(true); }} type="button">
                    <span className={`chat-system-avatar ${entry.config.channel}`}><NotificationChannelIcon channel={entry.config.channel} size={17} /></span>
                    <span><strong>{entry.config.label}</strong><small>{items[0]?.body ?? entry.config.empty}</small></span>
                    {unreadCount ? <b>{formatCount(unreadCount)}</b> : null}
                  </button>;
                })() : <ChatSidebarContactRow
                  active={entry.conversation.id === selectedId}
                  friendship={friendshipByUserId.get(entry.conversation.user.id) ?? null}
                  key={entry.conversation.id}
                  menuOpen={openFriendActionId === (friendshipByUserId.get(entry.conversation.user.id)?.id ?? 0)}
                  onAction={(friendship, action) => { setPendingFriendAction({ friendship, action }); setOpenFriendActionId(0); }}
                  onConversationAction={isDesktop ? (action) => {
                    setSelectedId(entry.conversation.id);
                    setPendingConversationAction(action);
                    setOpenFriendActionId(0);
                  } : undefined}
                  onOpen={() => { setSelectedId(entry.conversation.id); setIsMobileConversationOpen(true); }}
                  onToggleMenu={(friendshipId) => setOpenFriendActionId((current) => current === friendshipId ? 0 : friendshipId)}
                  preview={getConversationPreview(entry.conversation)}
                  unreadCount={entry.conversation.unreadCount}
                  user={entry.conversation.user}
                />)}

                {friendships.incoming.length ? <section className="chat-sidebar-section friend-request-list">
                  <h2><UserPlus aria-hidden="true" size={14} />好友申请 <b>{friendships.incoming.length}</b></h2>
                  {friendships.incoming.map((friendship) => (
                    <div className="friend-request-card" key={friendship.id}>
                      <UserAvatar user={friendship.user} />
                      <span><strong>{friendship.user.nickname}</strong><small>@{friendship.user.username}</small></span>
                      {friendship.note ? <p>{friendship.note}</p> : null}
                      <div><button onClick={() => void handleFriendRequest(friendship, "accepted")} title="接受" type="button"><Check aria-hidden="true" size={15} />接受</button><button onClick={() => void handleFriendRequest(friendship, "declined")} title="拒绝" type="button"><X aria-hidden="true" size={15} />拒绝</button></div>
                    </div>
                  ))}
                </section> : null}

                {filteredFriendsWithoutConversation.map((friendship) => (
                  <ChatSidebarContactRow
                    active={false}
                    friendship={friendship}
                    key={`friend-${friendship.id}`}
                    menuOpen={openFriendActionId === friendship.id}
                    onAction={(target, action) => { setPendingFriendAction({ friendship: target, action }); setOpenFriendActionId(0); }}
                    onOpen={() => void openFriendChat(friendship)}
                    onToggleMenu={(friendshipId) => setOpenFriendActionId((current) => current === friendshipId ? 0 : friendshipId)}
                    preview="开始聊天"
                    unreadCount={0}
                    user={friendship.user}
                  />
                ))}

                {friendships.outgoing.length ? <section className="chat-sidebar-section chat-pending-friends">
                  <h2>等待确认</h2>
                  {friendships.outgoing.map((friendship) => <div className="chat-pending-friend" key={friendship.id}><UserAvatar user={friendship.user} /><span><strong>{friendship.user.nickname}</strong><small>好友申请等待对方处理</small></span></div>)}
                </section> : null}

                {friendships.blocked.length ? <details className="chat-blocked-list">
                  <summary><Ban aria-hidden="true" size={14} />黑名单 <b>{friendships.blocked.length}</b></summary>
                  {friendships.blocked.map((friendship) => <div className="chat-blocked-row" key={friendship.id}><UserAvatar user={friendship.user} /><span><strong>{friendship.user.nickname}</strong><small>@{friendship.user.username}</small></span><button onClick={() => void handleUnblock(friendship)} title="解除拉黑" type="button"><ShieldOff aria-hidden="true" size={15} /></button></div>)}
                </details> : null}

                {!isLoading && normalizedFriendSearch && !primaryEntries.length && !filteredFriendsWithoutConversation.length ? <span className="chat-sidebar-empty">没有找到匹配的好友。</span> : null}
                {!isLoading && !normalizedFriendSearch && !conversations.length && !friendships.incoming.length && !friendships.friends.length && !friendships.outgoing.length ? <span className="chat-sidebar-empty">还没有好友或会话。</span> : null}
              </div>
            </div>
          </aside>
          <main className={`chat-panel${isNotificationSelected ? " system-selected" : ""}`}>
            {selectedNotificationConfig ? <NotificationPanel
              channel={selectedNotificationConfig.channel}
              emptyText={selectedNotificationConfig.empty}
              notifications={selectedNotifications}
              onMarkAllRead={readAllNotifications}
              onOpenArticle={(slug) => router.push(`/articles/${slug}`)}
              onSelect={handleNotification}
              selectedId={selectedSystemNotificationId}
              unreadCount={selectedUnreadNotifications}
              listRef={systemMessageListRef}
            /> : selected ? <>
              <div className="chat-message-list" ref={messageListRef}>
                {hasMore ? <button className="chat-load-older" onClick={() => void loadOlderMessages()} type="button"><ChevronUp aria-hidden="true" size={14} />更早消息</button> : null}
                {isMessagesLoading ? <span className="chat-state">正在读取聊天记录。</span> : messages.map((message) => (
                  <ChatMessageItem
                    actionOpen={openMessageActionId === message.id}
                    key={message.id}
                    message={message}
                    mine={message.sender.id === user.id}
                    onCall={() => callFromMessage(message)}
                    onDelete={() => setPendingMessageOperation({ operation: "delete-self", messageIds: [message.id] })}
                    onDeleteEveryone={() => setPendingMessageOperation({ operation: "delete-everyone", messageIds: [message.id] })}
                    onGreeting={() => void sendQuickMessage("你好")}
                    onPreview={setPreviewAttachment}
                    onRecall={() => setPendingMessageOperation({ operation: "recall", messageIds: [message.id] })}
                    onSelect={() => beginMessageSelection(message.id)}
                    onOpenActions={() => setOpenMessageActionId(message.id)}
                    onToggleSelection={() => toggleMessageSelection(message.id)}
                    onToggleActions={() => setOpenMessageActionId((current) => current === message.id ? 0 : message.id)}
                    selected={selectedMessageIds.has(message.id)}
                    selectionMode={isMessageSelectionMode}
                  />
                ))}
              </div>
              {isMessageSelectionMode ? <div className="chat-message-selection-bar">
                <button onClick={cancelMessageSelection} type="button">取消</button>
                <strong>已选择 {selectedMessageIds.size} 条</strong>
                <button disabled={!selectedMessageIds.size || isMessageActionRunning} onClick={() => requestSelectedMessageDeletion("self")} type="button"><Trash2 aria-hidden="true" size={15} />仅自己删除</button>
                <button className="danger" disabled={!selectedMessageIds.size || isMessageActionRunning} onClick={() => requestSelectedMessageDeletion("everyone")} type="button"><Trash2 aria-hidden="true" size={15} />双向删除</button>
              </div> : <form className="chat-composer" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} onSubmit={sendMessage}>
                {pendingAttachments.length ? <div className="chat-pending-attachments">{pendingAttachments.map((attachment) => (
                  <span key={attachment.id}>{attachment.kind === "image" && attachment.previewUrl
                    ? <img alt="" src={attachment.previewUrl} />
                    : attachment.kind === "audio"
                      ? <FileAudio aria-hidden="true" size={24} />
                      : attachment.kind === "video"
                        ? <FileVideo aria-hidden="true" size={24} />
                        : <FileText aria-hidden="true" size={22} />}<small title={attachment.file.name}>{attachment.file.name}</small><button aria-label={`移除 ${attachment.file.name}`} onClick={() => removePendingAttachment(attachment.id)} type="button"><X aria-hidden="true" size={13} /></button></span>
                ))}</div> : null}
                <div className="chat-composer-row">
                  <input accept=".jpg,.jpeg,.png,.webp,.webm,.m4a,.mp3,.wav,.ogg,.mp4,.mov,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.json,.xml,.rtf,.zip,.rar,.7z,.gz,.tar" hidden multiple onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} ref={fileInputRef} type="file" />
                  <div className="chat-composer-tools">
                    <button aria-label="更多聊天功能" className={`chat-mobile-more${isMobileToolsOpen ? " active" : ""}`} onClick={() => { setIsMobileToolsOpen((current) => !current); setIsEmojiOpen(false); }} title="更多" type="button"><Plus aria-hidden="true" size={19} /></button>
                    <button aria-label="添加表情" className={`chat-desktop-tool${isEmojiOpen ? " active" : ""}`} onClick={() => { setIsEmojiOpen((current) => !current); setIsMobileToolsOpen(false); }} title="表情" type="button"><Laugh aria-hidden="true" size={18} /></button>
                    <button aria-label="添加图片或文件" className="chat-desktop-tool" onClick={() => fileInputRef.current?.click()} title="添加图片或文件" type="button"><Paperclip aria-hidden="true" size={18} /></button>
                    <button aria-label={isVoiceRecording ? "结束语音录制" : "录制语音消息"} className={`chat-voice-tool${isVoiceRecording ? " active recording" : ""}`} disabled={Boolean(chatCalls.state)} onClick={() => isVoiceRecording ? cancelActiveVoiceRecording(false) : void startVoiceRecording()} title={isVoiceRecording ? `结束录制 ${formatDuration(voiceRecordingSeconds)}` : "语音消息"} type="button">{isVoiceRecording ? <Square aria-hidden="true" size={15} /> : <Mic aria-hidden="true" size={18} />}</button>
                  </div>
                  <textarea aria-label={`给 ${selected.user.nickname} 发消息`} maxLength={2000} onChange={(event) => updateDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} onPaste={handlePaste} placeholder="输入消息" rows={2} value={draft} />
                  <button aria-label="发送消息" disabled={isSending || isVoiceRecording || (!draft.trim() && !pendingAttachments.length)} title="发送消息" type="submit">{isSending ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : <Send aria-hidden="true" size={18} />}</button>
                </div>
                {isMobileToolsOpen ? <div className="chat-mobile-tools-panel">
                  <button onClick={() => { setIsMobileToolsOpen(false); setIsEmojiOpen(true); }} type="button"><span><Laugh aria-hidden="true" size={22} /></span><small>表情</small></button>
                  <button onClick={() => { setIsMobileToolsOpen(false); fileInputRef.current?.click(); }} type="button"><span><ImageIcon aria-hidden="true" size={22} /></span><small>图片与文件</small></button>
                </div> : null}
                {isEmojiOpen ? <div className="chat-emoji-picker">{EMOJIS.map((emoji) => <button key={emoji} onClick={() => { updateDraft(`${draft}${emoji}`); setIsEmojiOpen(false); }} type="button">{emoji}</button>)}</div> : null}
              </form>}
            </> : <div className="chat-empty"><MessageCircle aria-hidden="true" size={28} /><strong>选择一位好友开始聊天</strong><span>可以发送文字、表情、图片和文件。</span></div>}
          </main>
        </div>
        {isAddFriendOpen ? <div className="chat-confirm-backdrop" onClick={() => { if (!isFriendRequestSending) { setIsAddFriendOpen(false); setFriendRequestTarget(null); } }} role="presentation">
          <div aria-modal="true" className="chat-add-friend-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <header><span><UserPlus aria-hidden="true" size={18} /><strong>添加好友</strong></span><button aria-label="关闭添加好友" onClick={() => { setIsAddFriendOpen(false); setFriendRequestTarget(null); }} type="button"><X aria-hidden="true" size={17} /></button></header>
            {friendRequestTarget ? <div className="chat-friend-request-form">
              <div className="chat-user-search-result identity"><UserAvatar large user={friendRequestTarget} /><span><strong>{friendRequestTarget.nickname}</strong><small>@{friendRequestTarget.username}</small></span><RoleSymbol code={friendRequestTarget.isSuperAdmin ? "super_administrator" : friendRequestTarget.role.code} /></div>
              <label><span>申请备注</span><textarea maxLength={120} onChange={(event) => setFriendRequestNote(event.target.value)} placeholder="简单介绍一下自己，可不填" rows={3} value={friendRequestNote} /></label>
              <footer><button disabled={isFriendRequestSending} onClick={() => { setFriendRequestTarget(null); setFriendRequestNote(""); }} type="button">返回</button><button disabled={isFriendRequestSending} onClick={() => void sendFriendRequest()} type="button">{isFriendRequestSending ? "发送中" : "发送申请"}</button></footer>
            </div> : <>
              <label className="chat-user-search"><Search aria-hidden="true" size={16} /><input autoFocus maxLength={40} onChange={(event) => setUserSearch(event.target.value)} placeholder="搜索昵称或用户名" value={userSearch} />{userSearch ? <button aria-label="清空用户搜索" onClick={() => setUserSearch("")} type="button"><X aria-hidden="true" size={13} /></button> : null}</label>
              <div className="chat-user-search-results">
                {isUserSearching ? <span className="chat-state">正在搜索。</span> : null}
                {!isUserSearching && userSearch.trim().length < 2 ? <span className="chat-sidebar-empty">至少输入 2 个字符。</span> : null}
                {!isUserSearching && userSearch.trim().length >= 2 && !userSearchResults.length ? <span className="chat-sidebar-empty">没有找到匹配的用户。</span> : null}
                {userSearchResults.map((result) => <div className="chat-user-search-result" key={result.id}>
                  <UserAvatar user={result} />
                  <span><strong>{result.nickname}<RoleSymbol code={result.isSuperAdmin ? "super_administrator" : result.role.code} /></strong><small>@{result.username}</small></span>
                  {result.relationship?.status === "accepted" ? <button onClick={() => void openSearchResultChat(result)} type="button">发消息</button>
                    : result.canRequest ? <button onClick={() => { setFriendRequestTarget(result); setFriendRequestNote(""); }} type="button">添加</button>
                      : <small className="chat-user-search-status">{result.relationship?.status === "pending"
                        ? result.relationship.direction === "incoming" ? "对方已申请" : "等待确认"
                        : result.relationship?.status === "blocked" ? "暂不可添加" : "暂不可添加"}</small>}
                </div>)}
              </div>
            </>}
          </div>
        </div> : null}
        {pendingFriendAction ? <div className="chat-confirm-backdrop" onClick={() => { if (!isFriendActionRunning) setPendingFriendAction(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon">{pendingFriendAction.action === "block" ? <Ban aria-hidden="true" size={20} /> : <UserMinus aria-hidden="true" size={20} />}</span><div><strong>{pendingFriendAction.action === "block" ? `拉黑 ${pendingFriendAction.friendship.user.nickname}` : `删除好友 ${pendingFriendAction.friendship.user.nickname}`}</strong><p>{pendingFriendAction.action === "block" ? "拉黑后双方不能查看或发送聊天消息。历史记录会保留，解除拉黑后仍需重新添加好友。" : "删除后聊天记录会保留，但双方需要重新添加好友才能继续聊天。"}</p></div><footer><button disabled={isFriendActionRunning} onClick={() => setPendingFriendAction(null)} type="button">取消</button><button className="danger" disabled={isFriendActionRunning} onClick={() => void executeFriendAction()} type="button">{isFriendActionRunning ? "处理中" : pendingFriendAction.action === "block" ? "确认拉黑" : "确认删除"}</button></footer></div></div> : null}
        {pendingConversationAction ? <div className="chat-confirm-backdrop" onClick={() => { if (!isConversationActionRunning) setPendingConversationAction(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon">{pendingConversationAction === "clear" ? <Eraser aria-hidden="true" size={20} /> : <Trash2 aria-hidden="true" size={20} />}</span><div><strong>{pendingConversationAction === "clear" ? "清空当前聊天记录" : "从聊天列表删除会话"}</strong><p>{pendingConversationAction === "clear" ? "只清空当前账号可见的历史消息，会话入口和好友关系都会保留。" : "只从当前账号移除会话并清空历史，不会删除好友关系。之后可在左侧搜索好友，点击即可重新发起空会话。"}</p></div><footer><button disabled={isConversationActionRunning} onClick={() => setPendingConversationAction(null)} type="button">取消</button><button className="danger" disabled={isConversationActionRunning} onClick={() => void executeConversationAction()} type="button">{isConversationActionRunning ? "处理中" : "确认"}</button></footer></div></div> : null}
        {pendingMessageOperation ? <div className="chat-confirm-backdrop" onClick={() => { if (!isMessageActionRunning) setPendingMessageOperation(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon">{pendingMessageOperation.operation === "recall" ? <Undo2 aria-hidden="true" size={20} /> : <Trash2 aria-hidden="true" size={20} />}</span><div><strong>{pendingMessageOperation.operation === "recall" ? "撤回这条消息" : pendingMessageOperation.operation === "delete-everyone" ? `双向删除 ${pendingMessageOperation.messageIds.length} 条消息` : `仅自己删除 ${pendingMessageOperation.messageIds.length} 条消息`}</strong><p>{pendingMessageOperation.operation === "recall" ? "原消息和附件会被物理删除，双方聊天中会保留一条撤回提示。" : pendingMessageOperation.operation === "delete-everyone" ? "消息会从双方记录中永久删除，关联附件也会从磁盘删除，操作无法恢复。" : "这些消息只会从当前账号隐藏，对方仍然可以查看。"}</p></div><footer><button disabled={isMessageActionRunning} onClick={() => setPendingMessageOperation(null)} type="button">取消</button><button className="danger" disabled={isMessageActionRunning} onClick={() => void executeMessageOperation()} type="button">{isMessageActionRunning ? "处理中" : "确认"}</button></footer></div></div> : null}
        <button aria-label="调整聊天窗大小" className="chat-dock-resize-handle" onPointerDown={beginDockResize} tabIndex={-1} type="button" />
      </section>
      {previewAttachment ? <AttachmentPreview attachment={previewAttachment} onClose={closeAttachmentPreview} /> : null}
      {callPanel}
      <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </>
  );
}

function ChatSidebarContactRow({ active, friendship, menuOpen, preview, unreadCount, user, onAction, onConversationAction, onOpen, onToggleMenu }: {
  active: boolean;
  friendship: Friendship | null;
  menuOpen: boolean;
  preview: string;
  unreadCount: number;
  user: SocialUser;
  onAction: (friendship: Friendship, action: "remove" | "block") => void;
  onConversationAction?: (action: ConversationAction) => void;
  onOpen: () => void;
  onToggleMenu: (friendshipId: number) => void;
}) {
  return <div className={`chat-sidebar-contact-row${active ? " active" : ""}`}>
    <button className="chat-sidebar-primary-row" onClick={onOpen} type="button">
      <UserAvatar user={user} />
      <span><strong className="chat-conversation-name">{user.nickname}<RoleSymbol code={user.isSuperAdmin ? "super_administrator" : user.role.code} /></strong><small>{preview}</small></span>
      {unreadCount ? <b>{formatCount(unreadCount)}</b> : null}
    </button>
    {friendship ? <div className="chat-friend-action" data-chat-friend-action>
      <button aria-expanded={menuOpen} aria-label={`${user.nickname} 的好友操作`} className="chat-friend-action-trigger" onClick={(event) => { event.stopPropagation(); onToggleMenu(friendship.id); }} title="好友操作" type="button"><MoreHorizontal aria-hidden="true" size={16} /></button>
      {menuOpen ? <div className="chat-friend-action-menu">
        <button onClick={() => onAction(friendship, "remove")} type="button"><UserMinus aria-hidden="true" size={15} />删除好友</button>
        <button onClick={() => onAction(friendship, "block")} type="button"><Ban aria-hidden="true" size={15} />拉黑好友</button>
        {onConversationAction ? <>
          <span className="chat-friend-action-menu-divider" />
          <button onClick={() => onConversationAction("clear")} type="button"><Eraser aria-hidden="true" size={15} />清空聊天</button>
          <button className="danger" onClick={() => onConversationAction("delete")} type="button"><Trash2 aria-hidden="true" size={15} />删除聊天</button>
        </> : null}
      </div> : null}
    </div> : null}
  </div>;
}

function NotificationPanel({ channel, emptyText, notifications, selectedId, unreadCount, listRef, onMarkAllRead, onOpenArticle, onSelect }: {
  channel: NotificationChannel;
  emptyText: string;
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
            <span className="chat-system-notification-icon"><NotificationChannelIcon channel={channel} size={17} /></span>
            <span>
              <strong>{notification.title}</strong>
              <small>{notification.body}</small>
              {notification.context?.commentBody ? <q>{notification.context.commentBody}</q> : null}
              <time>{formatChatTime(notification.updatedAt || notification.createdAt)}</time>
            </span>
          </button>
          {notification.context?.article ? <button className="chat-system-article-link" onClick={() => onOpenArticle(notification.context!.article.slug)} type="button"><FileText aria-hidden="true" size={15} /><span><small>相关文章</small><strong>{notification.context.article.title}</strong></span><ChevronLeft aria-hidden="true" size={15} /></button> : null}
        </article>
      )) : <div className="chat-empty"><NotificationChannelIcon channel={channel} size={26} /><strong>暂时没有消息</strong><span>{emptyText}</span></div>}
    </div>
  </div>;
}

function ChatMessageItem({
  actionOpen,
  message,
  mine,
  selected,
  selectionMode,
  onCall,
  onDelete,
  onDeleteEveryone,
  onGreeting,
  onPreview,
  onRecall,
  onSelect,
  onOpenActions,
  onToggleActions,
  onToggleSelection,
}: {
  actionOpen: boolean;
  message: ChatMessage;
  mine: boolean;
  selected: boolean;
  selectionMode: boolean;
  onCall: () => void;
  onDelete: () => void;
  onDeleteEveryone: () => void;
  onGreeting: () => void;
  onPreview: (attachment: ChatAttachment) => void;
  onRecall: () => void;
  onSelect: () => void;
  onOpenActions: () => void;
  onToggleActions: () => void;
  onToggleSelection: () => void;
}) {
  const [renderedAt] = useState(() => Date.now());
  const callType = message.type === "system" ? message.call?.type ?? inferCallType(message.body) : null;
  const recallable = mine && message.type !== "system" && renderedAt - timestamp(message.createdAt) <= 2 * 60 * 1000;
  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (selectionMode) {
      onToggleSelection();
      return;
    }
    onOpenActions();
  }
  const selectionControl = selectionMode ? <button
    aria-label={selected ? "取消选择消息" : "选择消息"}
    aria-pressed={selected}
    className="chat-message-selector"
    onClick={onToggleSelection}
    type="button"
  >{selected ? <Check aria-hidden="true" size={13} /> : null}</button> : null;

  if (message.type === "system") {
    return <div className={`chat-system-row${selected ? " selected" : ""}`} onContextMenu={handleContextMenu}>
      {selectionControl}
      {callType ? <button className="chat-call-message" onClick={onCall} title={`再次发起${callType === "voice" ? "语音" : "视频"}通话`} type="button">
        {callType === "voice" ? <Phone aria-hidden="true" size={14} /> : <Video aria-hidden="true" size={14} />}
        <span>{message.body}</span>
      </button> : <span>{message.body}</span>}
      {message.body === "你们已经成为好友，可以开始聊天了。" ? <button onClick={onGreeting} type="button">打个招呼</button> : null}
      <time>{formatChatTime(message.createdAt)}</time>
      {!selectionMode ? <span className="chat-message-action" data-chat-message-action>
        <button aria-expanded={actionOpen} aria-label="系统消息操作" className="chat-message-action-trigger" onClick={onToggleActions} type="button"><MoreHorizontal aria-hidden="true" size={15} /></button>
        {actionOpen ? <span className="chat-message-action-menu">
          <button onClick={onSelect} type="button"><Check aria-hidden="true" size={14} />选择</button>
          <button onClick={onDelete} type="button"><Trash2 aria-hidden="true" size={14} />仅自己删除</button>
          <button className="danger" onClick={onDeleteEveryone} type="button"><Trash2 aria-hidden="true" size={14} />双向删除</button>
        </span> : null}
      </span> : null}
    </div>;
  }
  const emojiOnly = isEmojiOnly(message.body);
  return <div className={`chat-message ${mine ? "mine" : "theirs"}${emojiOnly ? " emoji-only" : ""}${selected ? " selected" : ""}`} onContextMenu={handleContextMenu}>
    {selectionControl}
    <UserAvatar user={message.sender} />
    <div>
      {message.attachments?.length ? <div className={`chat-message-attachments count-${Math.min(message.attachments.length, 4)}`}>{message.attachments.map((attachment) => attachment.kind === "image"
        ? <AuthenticatedImage attachment={attachment} key={attachment.id} onClick={() => onPreview(attachment)} />
        : attachment.kind === "audio" || attachment.kind === "video"
          ? <AuthenticatedMedia attachment={attachment} key={attachment.id} />
          : <AttachmentFile attachment={attachment} key={attachment.id} />)}</div> : null}
      {message.body ? <p>{message.body}</p> : null}
      <span>{formatChatTime(message.createdAt)}{mine ? ` · ${message.readAt ? "已读" : "未读"}` : ""}</span>
    </div>
    {!selectionMode ? <span className="chat-message-action" data-chat-message-action>
      <button aria-expanded={actionOpen} aria-label="消息操作" className="chat-message-action-trigger" onClick={onToggleActions} type="button"><MoreHorizontal aria-hidden="true" size={15} /></button>
      {actionOpen ? <span className="chat-message-action-menu">
        <button onClick={onSelect} type="button"><Check aria-hidden="true" size={14} />选择</button>
        {recallable ? <button onClick={onRecall} type="button"><Undo2 aria-hidden="true" size={14} />撤回消息</button> : null}
        <button onClick={onDelete} type="button"><Trash2 aria-hidden="true" size={14} />仅自己删除</button>
        <button className="danger" onClick={onDeleteEveryone} type="button"><Trash2 aria-hidden="true" size={14} />双向删除</button>
      </span> : null}
    </span> : null}
  </div>;
}

function AuthenticatedMedia({ attachment }: { attachment: ChatAttachment }) {
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
  if (!url) return <span className="chat-media-loading"><LoaderCircle aria-hidden="true" className="spin" size={18} /></span>;
  return attachment.kind === "audio"
    ? <audio className="chat-audio-attachment" controls preload="metadata" src={url} />
    : <video className="chat-video-attachment" controls playsInline preload="metadata" src={url} />;
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

function NotificationChannelIcon({ channel, size }: { channel: NotificationChannel; size: number }) {
  if (channel === "subscription") return <Rss aria-hidden="true" size={size} />;
  if (channel === "interaction") return <Heart aria-hidden="true" size={size} />;
  return <Bell aria-hidden="true" size={size} />;
}

function notificationConversationId(channel: NotificationChannel): number {
  return NOTIFICATION_CHANNELS.find((item) => item.channel === channel)?.id ?? -1;
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const valueOf = new Date(value).getTime();
  return Number.isNaN(valueOf) ? 0 : valueOf;
}

function defaultPrimaryId(conversations: Conversation[], notifications: SocialNotification[]): number {
  const latestConversation = conversations.map((conversation) => ({ id: conversation.id, at: timestamp(conversation.lastMessage?.createdAt ?? conversation.updatedAt) })).sort((left, right) => right.at - left.at)[0];
  const latestNotification = notifications.filter((notification) => notification.type !== "friend_request_received").map((notification) => ({ id: notificationConversationId(notification.channel), at: timestamp(notification.updatedAt || notification.createdAt) })).sort((left, right) => right.at - left.at)[0];
  if (latestNotification && (!latestConversation || latestNotification.at > latestConversation.at)) return latestNotification.id;
  return latestConversation?.id ?? notificationConversationId("system");
}

function getConversationPreview(conversation: Conversation): string {
  if (!conversation.lastMessage) return "开始聊天";
  if (conversation.lastMessage.body) return conversation.lastMessage.body;
  const attachments = conversation.lastMessage.attachments ?? [];
  if (attachments.length === 1 && attachments[0].kind === "audio") return "[语音消息]";
  if (attachments.length === 1 && attachments[0].kind === "video") return "[视频]";
  const count = attachments.length;
  return count ? `[${count} 个附件]` : "新消息";
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
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

function inferCallType(body: string): "voice" | "video" | null {
  if (body.startsWith("语音通话")) return "voice";
  if (body.startsWith("视频通话")) return "video";
  return null;
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

function readDockIconPosition(): DockIconPosition | null {
  try {
    const value = window.localStorage.getItem(DOCK_ICON_POSITION_STORAGE_KEY);
    return value ? JSON.parse(value) as DockIconPosition : null;
  } catch {
    return null;
  }
}

function getDefaultDockIconPosition(): DockIconPosition {
  return {
    x: window.innerWidth - DOCK_ICON_SIZE - 18,
    y: window.innerHeight - DOCK_ICON_SIZE - 18,
  };
}

function clampDockGeometry(value: DockGeometry): DockGeometry {
  const margin = DOCK_EDGE_MARGIN;
  const width = Math.min(Math.max(value.width, 520), window.innerWidth - margin * 2);
  const height = Math.min(Math.max(value.height, 380), window.innerHeight - margin * 2);
  const maxY = window.innerHeight - height - margin;
  const topbarBottom = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().bottom ?? 0;
  const minY = Math.min(Math.max(Math.ceil(topbarBottom) + margin, margin), maxY);
  return {
    width,
    height,
    x: Math.min(Math.max(value.x, margin), window.innerWidth - width - margin),
    y: Math.min(Math.max(value.y, minY), maxY),
  };
}

function clampDockIconPosition(value: DockIconPosition): DockIconPosition {
  return {
    x: Math.min(Math.max(value.x, DOCK_EDGE_MARGIN), window.innerWidth - DOCK_ICON_SIZE - DOCK_EDGE_MARGIN),
    y: Math.min(Math.max(value.y, DOCK_EDGE_MARGIN), window.innerHeight - DOCK_ICON_SIZE - DOCK_EDGE_MARGIN),
  };
}

function placeDockBesideIcon(geometry: DockGeometry, icon: DockIconPosition): DockGeometry {
  const openToRight = icon.x + DOCK_ICON_SIZE / 2 < window.innerWidth / 2;
  const x = openToRight
    ? icon.x + DOCK_ICON_SIZE + DOCK_ICON_GAP
    : icon.x - geometry.width - DOCK_ICON_GAP;
  return clampDockGeometry({
    ...geometry,
    x,
    y: icon.y + DOCK_ICON_SIZE - geometry.height,
  });
}

function trackDockPointer(onMove: (event: PointerEvent) => void, onFinish?: () => void) {
  const previousUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = "none";
  function finish() {
    document.body.style.userSelect = previousUserSelect;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    onFinish?.();
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
}
