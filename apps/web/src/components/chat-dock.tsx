"use client";

/* eslint-disable @next/next/no-img-element */

import {
  FileAudio,
  Ban,
  Bell,
  BellOff,
  Check,
  ChevronLeft,
  Clock3,
  Copy,
  Download,
  Eraser,
  FileText,
  FileVideo,
  Flag,
  Forward,
  Heart,
  Image as ImageIcon,
  Laugh,
  LoaderCircle,
  MessageCircle,
  MessageCircleMore,
  Minus,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Rss,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldOff,
  Square,
  Trash2,
  Undo2,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
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
import { ChatGroupManager } from "@/components/chat-group-manager";
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
  type NotificationChannelState,
  blockFriendship,
  clearNotifications,
  deleteNotification,
  deleteSelectedNotifications,
  downloadChatAttachment,
  downloadChatAttachmentThumbnail,
  getChatSocketOrigin,
  getOrCreateConversation,
  handleChatGroupReport,
  hideNotificationChannel,
  listConversations,
  listFriendships,
  listMessages,
  listNotifications,
  markAllNotificationsRead,
  markConversationRead,
  markNotificationRead,
  markSelectedNotificationsRead,
  removeFriendship,
  requestFriend,
  reportChatGroupMessage,
  respondChatGroupInvitationByGroup,
  respondChatGroupJoinRequest,
  respondFriendRequest,
  searchSocialUsers,
  unblockFriendship,
  updateConversationSettings,
  updateNotificationChannelSettings,
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
import {
  type BrowserPushState,
  disableBrowserPush,
  enableBrowserPush,
  getBrowserPushState,
} from "@/lib/push-api";

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

interface ForwardChatAck {
  ok: boolean;
  error?: string;
  messages?: ChatMessage[];
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

interface MessageActionPosition {
  left: number;
  top: number;
}

interface PendingFriendAction {
  friendship: Friendship;
  action: "remove" | "block";
}

interface PendingNotificationDeletion {
  channel: NotificationChannel | null;
  channelLabel: string;
  notificationIds: number[];
}

interface PendingNotificationChannelHide {
  channel: NotificationChannel;
  channelId: number;
  channelLabel: string;
}

interface PendingMessageForward {
  sourceConversationId: number;
  messageIds: number[];
}

type ConversationAction = "clear" | "delete";
type MessageDeleteMode = "self" | "everyone";
type MessageOperation = "delete-self" | "delete-everyone" | "recall";

const MESSAGE_ACTION_MENU_WIDTH = 154;
const MESSAGE_ACTION_MENU_HEIGHT = 220;
const NOTIFICATION_ACTION_MENU_HEIGHT = 118;
const MESSAGE_ACTION_MENU_GAP = 14;
const MESSAGE_ACTION_MENU_EDGE = 8;

export function ChatDock() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const discardVoiceRecordingRef = useRef(false);
  const voiceSendOnStopRef = useRef(false);
  const voiceConversationIdRef = useRef(0);
  const voiceTimerRef = useRef<number | null>(null);
  const sendHoldTimerRef = useRef<number | null>(null);
  const sendPointerHeldRef = useRef(false);
  const suppressSendClickRef = useRef(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const shouldScrollMessagesToBottomRef = useRef(false);
  const loadingOlderMessagesRef = useRef(false);
  const systemMessageListRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const selectedIdRef = useRef(0);
  const sessionUserIdRef = useRef(0);
  const openRef = useRef(false);
  const minimizedRef = useRef(false);
  const desktopRef = useRef(false);
  const mobileConversationOpenRef = useRef(false);
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
  const [notificationChannelStates, setNotificationChannelStates] = useState<NotificationChannelState[]>([]);
  const [hiddenNotificationChannels, setHiddenNotificationChannels] = useState<NotificationChannel[]>([]);
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
  const [isOlderMessagesLoading, setIsOlderMessagesLoading] = useState(false);
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
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [groupManagerInitialId, setGroupManagerInitialId] = useState<number | null>(null);
  const [groupManagerInitialView, setGroupManagerInitialView] = useState<"mine" | "invites">("mine");
  const [isMessageSettingsOpen, setIsMessageSettingsOpen] = useState(false);
  const [messageSettingsBusyKey, setMessageSettingsBusyKey] = useState("");
  const [browserPushState, setBrowserPushState] = useState<BrowserPushState | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<SocialUserSearchResult[]>([]);
  const [isUserSearching, setIsUserSearching] = useState(false);
  const [friendRequestTarget, setFriendRequestTarget] = useState<SocialUserSearchResult | null>(null);
  const [friendRequestNote, setFriendRequestNote] = useState("");
  const [isFriendRequestSending, setIsFriendRequestSending] = useState(false);
  const [pendingConversationAction, setPendingConversationAction] = useState<ConversationAction | null>(null);
  const [isConversationActionRunning, setIsConversationActionRunning] = useState(false);
  const [openMessageActionId, setOpenMessageActionId] = useState(0);
  const [messageActionPosition, setMessageActionPosition] = useState<MessageActionPosition | null>(null);
  const [messageActionOpenedAt, setMessageActionOpenedAt] = useState(() => Date.now());
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(new Set());
  const [isMessageSelectionMode, setIsMessageSelectionMode] = useState(false);
  const [isMessageActionRunning, setIsMessageActionRunning] = useState(false);
  const [pendingMessageOperation, setPendingMessageOperation] = useState<{
    operation: MessageOperation;
    messageIds: number[];
  } | null>(null);
  const [pendingMessageForward, setPendingMessageForward] = useState<PendingMessageForward | null>(null);
  const [pendingGroupReportMessageId, setPendingGroupReportMessageId] = useState(0);
  const [groupReportReason, setGroupReportReason] = useState("spam");
  const [groupReportDetail, setGroupReportDetail] = useState("");
  const [forwardTargetSearch, setForwardTargetSearch] = useState("");
  const [isForwardingMessages, setIsForwardingMessages] = useState(false);
  const [openNotificationChannelMenuId, setOpenNotificationChannelMenuId] = useState(0);
  const [openNotificationActionId, setOpenNotificationActionId] = useState(0);
  const [notificationActionPosition, setNotificationActionPosition] = useState<MessageActionPosition | null>(null);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<Set<number>>(new Set());
  const [isNotificationSelectionMode, setIsNotificationSelectionMode] = useState(false);
  const [isNotificationActionRunning, setIsNotificationActionRunning] = useState(false);
  const [pendingNotificationDeletion, setPendingNotificationDeletion] = useState<PendingNotificationDeletion | null>(null);
  const [pendingNotificationChannelHide, setPendingNotificationChannelHide] = useState<PendingNotificationChannelHide | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const actionMessage = useMemo(
    () => messages.find((message) => message.id === openMessageActionId) ?? null,
    [messages, openMessageActionId],
  );
  const actionNotification = useMemo(
    () => notifications.find((notification) => notification.id === openNotificationActionId) ?? null,
    [notifications, openNotificationActionId],
  );
  const channelNotifications = useMemo(
    () => ({
      system: notifications.filter((item) => item.channel === "system"),
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
    () => new Set(conversations.filter((conversation) => conversation.kind === "direct").map((conversation) => conversation.user.id)),
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
  const matchesConversationSearch = useCallback((conversation: Conversation) => {
    if (!normalizedFriendSearch) return true;
    if (conversation.group) return conversation.group.name.toLocaleLowerCase().includes(normalizedFriendSearch);
    return matchesFriendSearch(conversation.user);
  }, [matchesFriendSearch, normalizedFriendSearch]);
  const filteredFriendsWithoutConversation = useMemo(
    () => friendsWithoutConversation.filter((friendship) => matchesFriendSearch(friendship.user)),
    [friendsWithoutConversation, matchesFriendSearch],
  );
  const selectedNotificationConfig = NOTIFICATION_CHANNELS.find((item) => item.id === selectedId) ?? null;
  const selectedNotifications = selectedNotificationConfig ? channelNotifications[selectedNotificationConfig.channel] : [];
  const isNotificationSelected = Boolean(selectedNotificationConfig);
  const notificationChannelStateMap = useMemo(
    () => new Map(notificationChannelStates.map((state) => [state.channel, state])),
    [notificationChannelStates],
  );
  const pushDisabledChannels = useMemo(
    () => new Set(notificationChannelStates.filter((state) => !state.pushEnabled).map((state) => state.channel)),
    [notificationChannelStates],
  );
  const mutedConversations = useMemo(
    () => conversations.filter((conversation) => conversation.muted),
    [conversations],
  );
  const draft = selectedId ? drafts[selectedId] ?? "" : "";
  const pendingAttachments = selectedId ? pendingAttachmentsByConversation[selectedId] ?? [] : [];
  const unreadMessages = conversations.reduce((total, item) => total + (item.muted ? 0 : item.unreadCount), 0);
  const unreadNotifications = notifications.filter((item) => !item.readAt && !pushDisabledChannels.has(item.channel)).length;
  const selectedUnreadNotifications = selectedNotifications.filter((item) => !item.readAt).length;
  const selectedMessagesForAction = messages.filter((message) => selectedMessageIds.has(message.id));
  const selectedMessagesCanForward = Boolean(selectedMessageIds.size) &&
    selectedMessagesForAction.length === selectedMessageIds.size &&
    selectedMessagesForAction.every((message) => message.type !== "system");
  const normalizedForwardTargetSearch = forwardTargetSearch.trim().toLocaleLowerCase();
  const forwardTargets = friendships.friends.filter((friendship) =>
    friendship.user.id !== selected?.user.id && (
      !normalizedForwardTargetSearch ||
      friendship.user.nickname.toLocaleLowerCase().includes(normalizedForwardTargetSearch) ||
      friendship.user.username.toLocaleLowerCase().includes(normalizedForwardTargetSearch)
    ));
  const dockUnreadCount = unreadMessages + unreadNotifications;
  const primaryEntries = useMemo(() => [
    ...conversations.filter(matchesConversationSearch).map((conversation) => ({ kind: "conversation" as const, id: conversation.id, activityAt: conversation.lastMessage?.createdAt ?? conversation.updatedAt, conversation })),
    ...(!normalizedFriendSearch ? NOTIFICATION_CHANNELS.filter((config) => !hiddenNotificationChannels.includes(config.channel)).map((config) => ({ kind: "notification" as const, id: config.id, activityAt: channelNotifications[config.channel][0]?.updatedAt ?? channelNotifications[config.channel][0]?.createdAt ?? "", config })) : []),
  ].sort((left, right) => timestamp(right.activityAt) - timestamp(left.activityAt)), [channelNotifications, conversations, hiddenNotificationChannels, matchesConversationSearch, normalizedFriendSearch]);
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
    setIsMessageSettingsOpen(false);
    setIsMessageSelectionMode(false);
    setSelectedMessageIds(new Set());
    setOpenMessageActionId(0);
    setMessageActionPosition(null);
    setIsNotificationSelectionMode(false);
    setSelectedNotificationIds(new Set());
    setOpenNotificationActionId(0);
    setNotificationActionPosition(null);
  }, [selectedId]);

  useEffect(() => {
    openRef.current = isOpen;
    minimizedRef.current = isMinimized;
    desktopRef.current = isDesktop;
    mobileConversationOpenRef.current = isMobileConversationOpen;
  }, [isDesktop, isMinimized, isMobileConversationOpen, isOpen]);

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
      setNotificationChannelStates([]);
      setBrowserPushState(null);
      setHiddenNotificationChannels([]);
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
      setNotificationChannelStates(notificationResult.channelStates ?? []);
      const nextHiddenChannels = notificationResult.hiddenChannels ?? [];
      setHiddenNotificationChannels(nextHiddenChannels);
      setSelectedId((current) => {
        if (NOTIFICATION_CHANNELS.some((item) => item.id === current && !nextHiddenChannels.includes(item.channel))) return current;
        if (current && conversationResult.items.some((item) => item.id === current)) return current;
        return 0;
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
    if (!isMessageSettingsOpen) return;
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    setMessageSettingsBusyKey("browser:load");
    getBrowserPushState(token)
      .then((state) => { if (active) setBrowserPushState(state); })
      .catch(() => { if (active) setBrowserPushState(null); })
      .finally(() => { if (active) setMessageSettingsBusyKey(""); });
    return () => { active = false; };
  }, [isMessageSettingsOpen]);

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
    if (!selectedNotificationConfig || !selectedUnreadNotifications || !isOpen || isMinimized) return;
    if (!isDesktop && !isMobileConversationOpen) return;
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    const channel = selectedNotificationConfig.channel;
    markAllNotificationsRead(token, channel)
      .then((result) => {
        if (!active) return;
        setNotifications((current) => current.map((item) =>
          item.channel === channel && !item.readAt ? { ...item, readAt: result.readAt } : item,
        ));
        notifySocialStateChange();
      })
      .catch((actionError) => {
        if (active) setError(actionError instanceof Error ? actionError.message : "通知状态更新失败。");
      });
    return () => {
      active = false;
    };
  }, [isDesktop, isMinimized, isMobileConversationOpen, isOpen, selectedNotificationConfig, selectedUnreadNotifications]);

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
    if (!openMessageActionId && !openNotificationChannelMenuId && !openNotificationActionId) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("[data-chat-message-action]") || target.closest("[data-chat-notification-action]")) return;
      setOpenMessageActionId(0);
      setMessageActionPosition(null);
      setOpenNotificationChannelMenuId(0);
      setOpenNotificationActionId(0);
      setNotificationActionPosition(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenMessageActionId(0);
      setMessageActionPosition(null);
      setOpenNotificationChannelMenuId(0);
      setOpenNotificationActionId(0);
      setNotificationActionPosition(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMessageActionId, openNotificationActionId, openNotificationChannelMenuId]);

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
      const isViewing = message.conversationId === selectedIdRef.current &&
        openRef.current &&
        !minimizedRef.current &&
        (desktopRef.current || mobileConversationOpenRef.current);
      const messageList = messageListRef.current;
      const isNearMessageListBottom = !messageList ||
        messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight <= 96;
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
        if (isViewing && isNearMessageListBottom) shouldScrollMessagesToBottomRef.current = true;
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
      setIsMessagesLoading(false);
      return;
    }
    const isConversationVisible = isOpen &&
      !isMinimized &&
      (isDesktop || isMobileConversationOpen);
    if (!isConversationVisible) {
      setIsMessagesLoading(false);
      return;
    }
    let active = true;
    setIsMessagesLoading(true);
    shouldScrollMessagesToBottomRef.current = true;
    messageScrollRestoreRef.current = null;
    listMessages(token, selectedId)
      .then((result) => {
        if (!active) return null;
        setMessages(result.items);
        setHasMore(result.hasMore);
        setConversations((current) => current.map((item) =>
          item.id === selectedId ? { ...item, unreadCount: 0 } : item,
        ));
        return markConversationRead(token, selectedId);
      })
      .then((result) => {
        if (!active || result === null) return;
        socketRef.current?.emit("chat:read", { conversationId: selectedId });
        notifySocialStateChange();
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "聊天记录加载失败。");
      })
      .finally(() => {
        if (active) setIsMessagesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isDesktop, isMinimized, isMobileConversationOpen, isOpen, selectedId]);

  useEffect(() => {
    if (!isMessagesLoading && isOpen && !isMinimized) {
      window.requestAnimationFrame(() => {
        const list = messageListRef.current;
        if (!list) return;
        const restore = messageScrollRestoreRef.current;
        if (restore) {
          list.scrollTop = restore.top + list.scrollHeight - restore.height;
          messageScrollRestoreRef.current = null;
          return;
        }
        if (shouldScrollMessagesToBottomRef.current) {
          list.scrollTop = list.scrollHeight;
          shouldScrollMessagesToBottomRef.current = false;
        }
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
    sendPointerHeldRef.current = false;
    clearSendHoldTimer();
    if (voiceTimerRef.current !== null) window.clearInterval(voiceTimerRef.current);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function loadOlderMessages() {
    const token = readAccessToken();
    const firstId = messages[0]?.id;
    if (!token || !selectedId || !firstId || !hasMore || loadingOlderMessagesRef.current) return;
    const list = messageListRef.current;
    loadingOlderMessagesRef.current = true;
    setIsOlderMessagesLoading(true);
    if (list) messageScrollRestoreRef.current = { height: list.scrollHeight, top: list.scrollTop };
    try {
      const result = await listMessages(token, selectedId, firstId);
      setMessages((current) => [...result.items, ...current]);
      setHasMore(result.hasMore);
    } catch (loadError) {
      messageScrollRestoreRef.current = null;
      setError(loadError instanceof Error ? loadError.message : "更早的消息加载失败。");
    } finally {
      loadingOlderMessagesRef.current = false;
      setIsOlderMessagesLoading(false);
    }
  }

  function handleMessageListScroll() {
    const list = messageListRef.current;
    if (!list || list.scrollTop > 280 || !hasMore || isMessagesLoading) return;
    void loadOlderMessages();
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
    if (discard) voiceSendOnStopRef.current = false;
    if (recorder.state !== "inactive") recorder.stop();
    else {
      clearVoiceTimer();
      releaseVoiceStream();
      mediaRecorderRef.current = null;
      setIsVoiceRecording(false);
      setVoiceRecordingSeconds(0);
    }
  }

  async function startVoiceRecording(sendOnStop = false) {
    if (!selectedId || isVoiceRecording || chatCalls.state || chatCalls.isPreparing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持语音录制。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (sendOnStop && !sendPointerHeldRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      discardVoiceRecordingRef.current = false;
      voiceSendOnStopRef.current = sendOnStop;
      voiceConversationIdRef.current = selectedId;
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
        const voiceFile = new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type });
        if (voiceSendOnStopRef.current) {
          voiceSendOnStopRef.current = false;
          void sendPayload(voiceConversationIdRef.current, "", [voiceFile]);
        } else {
          addFiles([voiceFile]);
        }
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
    if (!validateFiles(files, pendingAttachments.map((item) => item.file))) return;
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

  // Images chosen from the file picker are intentional and can be sent immediately.
  // Pasted or dropped files still enter the composer so accidental clipboard files are reviewable.
  function handleSelectedFiles(files: File[]) {
    if (!files.length) return;
    if (files.every((file) => file.type.startsWith("image/")) && selectedId && !isSending) {
      if (!validateFiles(files, [])) return;
      void sendPayload(selectedId, "", files, false);
      return;
    }
    addFiles(files);
  }

  function validateFiles(files: File[], existingFiles: File[]): boolean {
    if (files.length > MAX_ATTACHMENTS - existingFiles.length) {
      setError(`每条消息最多添加 ${MAX_ATTACHMENTS} 个图片或文件。`);
      return false;
    }
    if ([...existingFiles, ...files].reduce((total, file) => total + file.size, 0) > MAX_BATCH_SIZE) {
      setError("一条消息的附件总大小不能超过 50MB。");
      return false;
    }
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = file.type.startsWith("image/");
      const isAudio = file.type.startsWith("audio/");
      const isVideo = file.type.startsWith("video/");
      if (BLOCKED_EXTENSIONS.has(extension)) {
        setError(`不允许发送可执行文件或脚本：${file.name}`);
        return false;
      }
      if (isImage && file.size > MAX_IMAGE_SIZE) {
        setError(`单张图片不能超过 8MB：${file.name}`);
        return false;
      }
      if (isAudio && file.size > MAX_AUDIO_SIZE) {
        setError(`单个音频不能超过 20MB：${file.name}`);
        return false;
      }
      if (isVideo && file.size > MAX_VIDEO_SIZE) {
        setError(`单个视频不能超过 50MB：${file.name}`);
        return false;
      }
      if (!isImage && !isAudio && !isVideo && file.size > MAX_FILE_SIZE) {
        setError(`单个普通文件不能超过 20MB：${file.name}`);
        return false;
      }
    }
    return true;
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

  async function sendPayload(conversationId: number, body: string, files: File[], clearComposer = false) {
    const socket = socketRef.current;
    const token = readAccessToken();
    if ((!body && !files.length) || !conversationId || !token) return;
    if (!socket?.connected) {
      setError("聊天连接尚未建立，请稍后重试。");
      return;
    }
    setIsSending(true);
    try {
      const attachments = files.length
        ? await uploadChatAttachments(token, conversationId, files)
        : [];
      const response = await socket.timeout(10000).emitWithAck("chat:send", {
        conversationId,
        body,
        attachmentIds: attachments.map((item) => item.id),
      }) as ChatAck;
      if (!response.ok) throw new Error(response.error || "消息发送失败。");
      if (clearComposer) {
        updateDraft("");
        pendingAttachments.forEach((attachment) => {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        });
        setPendingAttachments([]);
        setIsEmojiOpen(false);
        setIsMobileToolsOpen(false);
      }
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

  async function toggleConversationMute(conversation: Conversation, muted: boolean) {
    const token = readAccessToken();
    if (!token) return;
    setMessageSettingsBusyKey(`conversation:${conversation.id}`);
    try {
      const updated = await updateConversationSettings(token, conversation.id, { muted });
      setConversations((current) => current.map((item) =>
        item.id === updated.id ? { ...item, muted: updated.muted, unreadCount: updated.unreadCount } : item,
      ));
      setOpenFriendActionId(0);
      setNotice(muted ? "已开启消息免打扰。" : "已关闭消息免打扰。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "免打扰设置失败。");
    } finally {
      setMessageSettingsBusyKey("");
    }
  }

  async function toggleNotificationChannelPush(channel: NotificationChannel, channelLabel: string, pushEnabled: boolean) {
    const token = readAccessToken();
    if (!token) return;
    setMessageSettingsBusyKey(`channel:${channel}`);
    try {
      const state = await updateNotificationChannelSettings(token, channel, { pushEnabled });
      setNotificationChannelStates((current) => [
        state,
        ...current.filter((item) => item.channel !== channel),
      ]);
      setOpenNotificationChannelMenuId(0);
      setNotice(pushEnabled ? `${channelLabel}已接收推送。` : `${channelLabel}已暂停推送。`);
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "频道推送设置失败。");
    } finally {
      setMessageSettingsBusyKey("");
    }
  }

  async function toggleBrowserPush() {
    const token = readAccessToken();
    if (!token || messageSettingsBusyKey) return;
    setMessageSettingsBusyKey("browser:toggle");
    try {
      const state = browserPushState?.subscribed
        ? await disableBrowserPush(token)
        : await enableBrowserPush(token);
      setBrowserPushState(state);
      setNotice(state.subscribed ? "当前设备已开启浏览器推送。" : "当前设备已关闭浏览器推送。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "浏览器推送设置失败。");
    } finally {
      setMessageSettingsBusyKey("");
    }
  }

  async function resetMessagePreferences() {
    const token = readAccessToken();
    if (!token || messageSettingsBusyKey) return;
    setMessageSettingsBusyKey("reset");
    try {
      const [conversationResults, channelResults] = await Promise.all([
        Promise.all(mutedConversations.map((conversation) =>
          updateConversationSettings(token, conversation.id, { muted: false })
        )),
        Promise.all(NOTIFICATION_CHANNELS.map((config) =>
          updateNotificationChannelSettings(token, config.channel, { pushEnabled: true })
        )),
      ]);
      const conversationMap = new Map(conversationResults.map((conversation) => [conversation.id, conversation]));
      setConversations((current) => current.map((conversation) =>
        conversationMap.has(conversation.id)
          ? { ...conversation, muted: false }
          : conversation
      ));
      setNotificationChannelStates((current) => {
        const resetChannels = new Set(channelResults.map((state) => state.channel));
        return [...channelResults, ...current.filter((state) => !resetChannels.has(state.channel))];
      });
      setNotice("消息设置已恢复默认。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "消息设置恢复失败。");
    } finally {
      setMessageSettingsBusyKey("");
    }
  }

  function beginMessageSelection(messageId: number) {
    setOpenMessageActionId(0);
    setMessageActionPosition(null);
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
    setMessageActionPosition(null);
  }

  function openMessageActionsAtPointer(messageId: number, event: ReactMouseEvent<HTMLDivElement>) {
    const dockBounds = dockRef.current?.getBoundingClientRect();
    if (!dockBounds) {
      setOpenMessageActionId(messageId);
      setMessageActionPosition(null);
      return;
    }
    const pointerX = event.clientX - dockBounds.left;
    const pointerY = event.clientY - dockBounds.top;
    const preferredLeft = pointerX + MESSAGE_ACTION_MENU_GAP;
    const hasRoomOnRight = preferredLeft + MESSAGE_ACTION_MENU_WIDTH <= dockBounds.width - MESSAGE_ACTION_MENU_EDGE;
    const left = hasRoomOnRight
      ? preferredLeft
      : Math.max(MESSAGE_ACTION_MENU_EDGE, pointerX - MESSAGE_ACTION_MENU_WIDTH - MESSAGE_ACTION_MENU_GAP);
    const preferredTop = pointerY + MESSAGE_ACTION_MENU_GAP;
    const hasRoomBelow = preferredTop + MESSAGE_ACTION_MENU_HEIGHT <= dockBounds.height - MESSAGE_ACTION_MENU_EDGE;
    const top = hasRoomBelow
      ? preferredTop
      : Math.max(MESSAGE_ACTION_MENU_EDGE, pointerY - MESSAGE_ACTION_MENU_HEIGHT - MESSAGE_ACTION_MENU_GAP);
    setMessageActionOpenedAt(Date.now());
    setOpenMessageActionId(messageId);
    setMessageActionPosition({ left, top });
  }

  function requestMessageOperation(operation: MessageOperation, messageId: number) {
    setOpenMessageActionId(0);
    setMessageActionPosition(null);
    setPendingMessageOperation({ operation, messageIds: [messageId] });
  }

  function openMobileMessageActions(messageId: number) {
    setMessageActionOpenedAt(Date.now());
    setMessageActionPosition(null);
    setOpenMessageActionId(messageId);
  }

  async function copyMessageBody(message: ChatMessage) {
    if (!message.body) return;
    try {
      await navigator.clipboard.writeText(message.body);
      setOpenMessageActionId(0);
      setMessageActionPosition(null);
      setNotice("消息文字已复制。");
    } catch {
      setError("复制失败，请检查浏览器的剪贴板权限。");
    }
  }

  function openMessageForward(messageIds: number[]) {
    if (!selected || !messageIds.length) return;
    setOpenMessageActionId(0);
    setMessageActionPosition(null);
    setForwardTargetSearch("");
    setPendingMessageForward({ sourceConversationId: selected.id, messageIds });
  }

  async function forwardMessagesTo(friendship: Friendship) {
    const token = readAccessToken();
    const socket = socketRef.current;
    if (!token || !socket?.connected || !pendingMessageForward || isForwardingMessages) return;
    setIsForwardingMessages(true);
    try {
      const targetConversation = await getOrCreateConversation(token, friendship.user.id);
      setConversations((current) => [targetConversation, ...current.filter((item) => item.id !== targetConversation.id)]);
      const response = await socket.timeout(20_000).emitWithAck("chat:messages:forward", {
        sourceConversationId: pendingMessageForward.sourceConversationId,
        targetConversationId: targetConversation.id,
        messageIds: pendingMessageForward.messageIds,
      }) as ForwardChatAck;
      if (!response.ok) throw new Error(response.error || "消息转发失败。");
      const forwardedCount = response.messages?.length ?? pendingMessageForward.messageIds.length;
      setPendingMessageForward(null);
      cancelMessageSelection();
      setNotice(`已向 ${friendship.user.nickname} 转发 ${forwardedCount} 条消息。`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "消息转发失败。");
    } finally {
      setIsForwardingMessages(false);
    }
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
    if (!notification.openedAt) {
      try {
        const updatedNotification = await markNotificationRead(token, notification.id);
        setNotifications((current) => current.map((item) =>
          item.id === notification.id ? {
            ...item,
            readAt: updatedNotification.readAt,
            openedAt: updatedNotification.openedAt,
          } : item,
        ));
        notifySocialStateChange();
      } catch {
        // Following the action is still useful if read-state persistence fails.
      }
    }
    if (notification.context?.kind === "announcement" && notification.actionUrl) {
      router.push(notification.actionUrl);
      setIsMinimized(true);
      return;
    }
    if (notification.type === "friend_request_received") {
      setSelectedId(notificationConversationId("system"));
      setSelectedSystemNotificationId(notification.id);
      setIsMobileConversationOpen(true);
      return;
    }
    if (notification.context?.groupId) {
      setGroupManagerInitialId(notification.context.kind === "group_invitation" ? null : notification.context.groupId);
      setGroupManagerInitialView(notification.context.kind === "group_invitation" || notification.context.kind === "group_join_request" ? "invites" : "mine");
      setIsGroupManagerOpen(true);
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

  function beginNotificationSelection(notificationId?: number) {
    setOpenNotificationChannelMenuId(0);
    setOpenNotificationActionId(0);
    setNotificationActionPosition(null);
    setIsNotificationSelectionMode(true);
    setSelectedNotificationIds(notificationId ? new Set([notificationId]) : new Set());
  }

  function toggleNotificationSelection(notificationId: number) {
    setSelectedNotificationIds((current) => {
      const next = new Set(current);
      if (next.has(notificationId)) next.delete(notificationId);
      else next.add(notificationId);
      return next;
    });
  }

  function cancelNotificationSelection() {
    setIsNotificationSelectionMode(false);
    setSelectedNotificationIds(new Set());
    setOpenNotificationActionId(0);
    setNotificationActionPosition(null);
  }

  function openNotificationActionsAtPointer(notificationId: number, event: ReactMouseEvent<HTMLElement>) {
    const dockBounds = dockRef.current?.getBoundingClientRect();
    if (!dockBounds) {
      setOpenNotificationActionId(notificationId);
      setNotificationActionPosition(null);
      return;
    }
    const pointerX = event.clientX - dockBounds.left;
    const pointerY = event.clientY - dockBounds.top;
    const preferredLeft = pointerX + MESSAGE_ACTION_MENU_GAP;
    const hasRoomOnRight = preferredLeft + MESSAGE_ACTION_MENU_WIDTH <= dockBounds.width - MESSAGE_ACTION_MENU_EDGE;
    const left = hasRoomOnRight
      ? preferredLeft
      : Math.max(MESSAGE_ACTION_MENU_EDGE, pointerX - MESSAGE_ACTION_MENU_WIDTH - MESSAGE_ACTION_MENU_GAP);
    const preferredTop = pointerY + MESSAGE_ACTION_MENU_GAP;
    const hasRoomBelow = preferredTop + NOTIFICATION_ACTION_MENU_HEIGHT <= dockBounds.height - MESSAGE_ACTION_MENU_EDGE;
    const top = hasRoomBelow
      ? preferredTop
      : Math.max(MESSAGE_ACTION_MENU_EDGE, pointerY - NOTIFICATION_ACTION_MENU_HEIGHT - MESSAGE_ACTION_MENU_GAP);
    setOpenNotificationActionId(notificationId);
    setNotificationActionPosition({ left, top });
  }

  function toggleMobileNotificationActions(notificationId: number) {
    setNotificationActionPosition(null);
    setOpenNotificationActionId((current) => current === notificationId ? 0 : notificationId);
  }

  async function markNotificationSelectionRead(notificationIds: number[]) {
    const token = readAccessToken();
    if (!token || !notificationIds.length || isNotificationActionRunning) return;
    setIsNotificationActionRunning(true);
    try {
      const result = await markSelectedNotificationsRead(token, notificationIds);
      const selectedIds = new Set(notificationIds);
      setNotifications((current) => current.map((item) => selectedIds.has(item.id) && !item.openedAt
        ? { ...item, readAt: result.readAt, openedAt: result.readAt }
        : item));
      cancelNotificationSelection();
      setNotice(result.count ? `已将 ${result.count} 条通知标为已读。` : "所选通知均已是已读状态。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "通知状态更新失败。");
    } finally {
      setIsNotificationActionRunning(false);
    }
  }

  function requestNotificationDeletion(notificationIds: number[]) {
    if (!notificationIds.length) return;
    setOpenNotificationActionId(0);
    setNotificationActionPosition(null);
    setPendingNotificationDeletion({ channel: null, channelLabel: "", notificationIds });
  }

  function requestNotificationChannelClear(channel: NotificationChannel, channelLabel: string) {
    setOpenNotificationChannelMenuId(0);
    setPendingNotificationDeletion({
      channel,
      channelLabel,
      notificationIds: [],
    });
  }

  function requestNotificationChannelHide(channel: NotificationChannel, channelId: number, channelLabel: string) {
    setOpenNotificationChannelMenuId(0);
    setPendingNotificationChannelHide({ channel, channelId, channelLabel });
  }

  async function executeNotificationChannelHide() {
    const token = readAccessToken();
    if (!token || !pendingNotificationChannelHide || isNotificationActionRunning) return;
    setIsNotificationActionRunning(true);
    try {
      const target = pendingNotificationChannelHide;
      const result = await hideNotificationChannel(token, target.channel);
      setNotifications((current) => current.map((item) =>
        item.channel === target.channel && item.type !== "friend_request_received" && !item.readAt
          ? { ...item, readAt: result.readAt }
          : item));
      setHiddenNotificationChannels((current) => current.includes(target.channel) ? current : [...current, target.channel]);
      setPendingNotificationChannelHide(null);
      if (selectedId === target.channelId) {
        setSelectedId(0);
        setSelectedSystemNotificationId(0);
        setIsMobileConversationOpen(false);
      }
      setNotice(`${target.channelLabel}已从消息列表删除，新通知到达后会重新显示。`);
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "通知频道删除失败。");
    } finally {
      setIsNotificationActionRunning(false);
    }
  }

  async function executeNotificationDeletion() {
    const token = readAccessToken();
    if (!token || !pendingNotificationDeletion || isNotificationActionRunning) return;
    setIsNotificationActionRunning(true);
    try {
      const target = pendingNotificationDeletion;
      const result = target.channel
        ? await clearNotifications(token, target.channel)
        : target.notificationIds.length === 1
          ? await deleteNotification(token, target.notificationIds[0])
          : await deleteSelectedNotifications(token, target.notificationIds);
      if (target.channel) {
        setNotifications((current) => current.filter((item) => item.channel !== target.channel || item.type === "friend_request_received"));
        setSelectedSystemNotificationId(0);
      } else {
        const deletedIds = new Set(target.notificationIds);
        setNotifications((current) => current.filter((item) => !deletedIds.has(item.id)));
        if (deletedIds.has(selectedSystemNotificationId)) setSelectedSystemNotificationId(0);
      }
      setPendingNotificationDeletion(null);
      cancelNotificationSelection();
      setNotice(target.channel ? `${target.channelLabel}已清空。` : `已删除 ${result.count} 条通知。`);
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "通知删除失败。");
    } finally {
      setIsNotificationActionRunning(false);
    }
  }

  function closeDock() {
    setIsOpen(false);
    setIsMinimized(false);
    setIsMessageSettingsOpen(false);
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

  async function handleGroupNotificationAction(
    notification: SocialNotification,
    action: "accept" | "reject" | "resolve-report" | "reject-report",
  ) {
    const token = readAccessToken();
    const context = notification.context;
    if (!token || !context) return;
    setIsNotificationActionRunning(true);
    try {
      if (context.kind === "friend_request" && notification.friendshipId) {
        await respondFriendRequest(token, notification.friendshipId, action === "accept" ? "accepted" : "declined");
      } else if (context.kind === "group_invitation" && context.groupId) {
        await respondChatGroupInvitationByGroup(token, context.groupId, action === "accept" ? "accepted" : "declined");
      } else if (context.kind === "group_join_request" && context.groupId && context.joinRequestId) {
        await respondChatGroupJoinRequest(token, context.groupId, context.joinRequestId, action === "accept" ? "approved" : "rejected");
      } else if (context.kind === "group_report" && context.reportId) {
        await handleChatGroupReport(token, context.reportId, action === "resolve-report"
          ? { status: "resolved", deleteMessage: true, resolution: "群管理员已删除被举报消息" }
          : { status: "rejected", resolution: "未发现违规" });
      } else {
        setGroupManagerInitialId(context.groupId ?? null);
        setGroupManagerInitialView(context.kind === "group_join_request" ? "invites" : "mine");
        setIsGroupManagerOpen(true);
        return;
      }
      await deleteNotification(token, notification.id);
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
      await refreshSocialData();
      setNotice(action === "accept" ? "已同意。" : action === "reject" ? "已拒绝。" : action === "resolve-report" ? "举报已处理。" : "举报已驳回。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "群审批处理失败。");
    } finally {
      setIsNotificationActionRunning(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendPayload(selectedId, draft.trim(), pendingAttachments.map((item) => item.file), true);
  }

  function clearSendHoldTimer() {
    if (sendHoldTimerRef.current !== null) window.clearTimeout(sendHoldTimerRef.current);
    sendHoldTimerRef.current = null;
  }

  function handleSendPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || isSending || chatCalls.state) return;
    sendPointerHeldRef.current = true;
    suppressSendClickRef.current = false;
    clearSendHoldTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    sendHoldTimerRef.current = window.setTimeout(() => {
      sendHoldTimerRef.current = null;
      suppressSendClickRef.current = true;
      void startVoiceRecording(true);
    }, 480);
  }

  function handleSendPointerUp() {
    sendPointerHeldRef.current = false;
    clearSendHoldTimer();
    if (mediaRecorderRef.current?.state === "recording") cancelActiveVoiceRecording(false);
  }

  function handleSendPointerCancel() {
    sendPointerHeldRef.current = false;
    clearSendHoldTimer();
    if (mediaRecorderRef.current) cancelActiveVoiceRecording(true);
  }

  async function submitGroupReport() {
    const token = readAccessToken();
    if (!token || !selected?.group || !pendingGroupReportMessageId) return;
    setIsMessageActionRunning(true);
    try {
      await reportChatGroupMessage(token, selected.group.id, pendingGroupReportMessageId, {
        reason: groupReportReason,
        detail: groupReportDetail.trim() || undefined,
      });
      setPendingGroupReportMessageId(0);
      setGroupReportDetail("");
      setNotice("举报已提交，群管理员可以在群资料中处理。");
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "举报提交失败。");
    } finally {
      setIsMessageActionRunning(false);
    }
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

  const messageActionStyle: CSSProperties | undefined = messageActionPosition ? {
    left: messageActionPosition.left,
    top: messageActionPosition.top,
    right: "auto",
  } : undefined;

  const notificationActionStyle: CSSProperties | undefined = notificationActionPosition ? {
    left: notificationActionPosition.left,
    top: notificationActionPosition.top,
    right: "auto",
  } : undefined;

  const openNotificationChannel = NOTIFICATION_CHANNELS.find((item) => item.id === openNotificationChannelMenuId) ?? null;
  const openNotificationChannelItems = openNotificationChannel ? channelNotifications[openNotificationChannel.channel] : [];

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
      <section className={`chat-dock${isMobileConversationOpen ? " mobile-conversation-open" : ""}`} aria-label="消息与聊天" ref={dockRef} style={dockStyle}>
        <header className="chat-dock-titlebar" onPointerDown={beginDockDrag}>
          {!isDesktop && isMobileConversationOpen ? <button
              aria-label="返回消息列表"
              className="chat-mobile-back"
              onClick={() => setIsMobileConversationOpen(false)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={19} />
            </button> : null}
          <span><MessageCircleMore aria-hidden="true" size={18} /><strong>{selectedNotificationConfig?.label ?? selected?.group?.name ?? selected?.user.nickname ?? "消息"}</strong></span>
          <div>
            {isDesktop || !isMobileConversationOpen ? <button aria-label="添加好友" onClick={() => { setIsAddFriendOpen(true); setUserSearch(""); setUserSearchResults([]); }} title="添加好友" type="button"><UserPlus aria-hidden="true" size={17} /></button> : null}
            {isDesktop || !isMobileConversationOpen ? <button aria-label="群聊" onClick={() => { setGroupManagerInitialId(null); setGroupManagerInitialView("mine"); setIsGroupManagerOpen(true); }} title="群聊" type="button"><Users aria-hidden="true" size={17} /></button> : null}
            {isDesktop || !isMobileConversationOpen ? <button aria-expanded={isMessageSettingsOpen} aria-label="消息设置" onClick={() => setIsMessageSettingsOpen((current) => !current)} title="消息设置" type="button"><Settings2 aria-hidden="true" size={17} /></button> : null}
            {selected?.group && !isDesktop && isMobileConversationOpen ? <button aria-label="群资料" onClick={() => { setGroupManagerInitialId(selected.group!.id); setGroupManagerInitialView("mine"); setIsGroupManagerOpen(true); }} title="群资料" type="button"><Users aria-hidden="true" size={17} /></button> : null}
            {selected?.kind === "direct" && (isDesktop || isMobileConversationOpen) ? <>
              <button aria-label="发起语音通话" disabled={isVoiceRecording || chatCalls.isPreparing || Boolean(chatCalls.state)} onClick={() => void chatCalls.startCall("voice")} title="语音通话" type="button"><Phone aria-hidden="true" size={17} /></button>
              <button aria-label="发起视频通话" disabled={isVoiceRecording || chatCalls.isPreparing || Boolean(chatCalls.state)} onClick={() => void chatCalls.startCall("video")} title="视频通话" type="button"><Video aria-hidden="true" size={17} /></button>
            </> : null}
            <button aria-label="最小化聊天窗" onClick={() => { setIsMessageSettingsOpen(false); setIsMinimized(true); }} type="button"><Minus aria-hidden="true" size={17} /></button>
            <button aria-label="关闭聊天窗" onClick={closeDock} type="button"><X aria-hidden="true" size={17} /></button>
          </div>
        </header>
        {isMessageSettingsOpen ? <section className="chat-message-settings" onPointerDown={(event) => event.stopPropagation()}>
          <header>
            <span><Settings2 aria-hidden="true" size={17} /><strong>消息设置</strong></span>
            <button aria-label="关闭消息设置" onClick={() => setIsMessageSettingsOpen(false)} type="button"><X aria-hidden="true" size={16} /></button>
          </header>
          <div className="chat-message-settings-section browser-push-section">
            <span className="chat-message-settings-label">当前设备</span>
            <button
              aria-pressed={browserPushState?.subscribed ?? false}
              className="chat-message-setting-row"
              disabled={Boolean(messageSettingsBusyKey) || browserPushState?.supported === false || browserPushState?.enabled === false}
              onClick={() => void toggleBrowserPush()}
              type="button"
            >
              <span><strong>浏览器推送</strong><small>{browserPushDescription(browserPushState)}</small></span>
              <i className={browserPushState?.subscribed ? "active" : ""}>{messageSettingsBusyKey.startsWith("browser:") ? <LoaderCircle aria-hidden="true" className="spin" size={13} /> : null}</i>
            </button>
          </div>
          <div className="chat-message-settings-section">
            <span className="chat-message-settings-label">通知频道</span>
            {NOTIFICATION_CHANNELS.map((config) => {
              const pushEnabled = notificationChannelStateMap.get(config.channel)?.pushEnabled ?? true;
              const busy = messageSettingsBusyKey === `channel:${config.channel}`;
              return <button
                aria-pressed={pushEnabled}
                className="chat-message-setting-row"
                disabled={Boolean(messageSettingsBusyKey)}
                key={config.channel}
                onClick={() => void toggleNotificationChannelPush(config.channel, config.label, !pushEnabled)}
                type="button"
              >
                <span><strong>{config.label}</strong><small>{pushEnabled ? "接收站内提醒和设备推送" : "已暂停该频道提醒"}</small></span>
                <i className={pushEnabled ? "active" : ""}>{busy ? <LoaderCircle aria-hidden="true" className="spin" size={13} /> : null}</i>
              </button>;
            })}
          </div>
          <div className="chat-message-settings-section">
            <span className="chat-message-settings-label">免打扰会话</span>
            {mutedConversations.map((conversation) => <button
              className="chat-message-setting-row conversation"
              disabled={Boolean(messageSettingsBusyKey)}
              key={conversation.id}
              onClick={() => void toggleConversationMute(conversation, false)}
              type="button"
            >
              <ConversationAvatar conversation={conversation} />
              <span><strong>{conversation.group?.name ?? conversation.user.nickname}</strong><small>点击恢复消息提醒</small></span>
              {messageSettingsBusyKey === `conversation:${conversation.id}`
                ? <LoaderCircle aria-hidden="true" className="spin" size={14} />
                : <Bell aria-hidden="true" size={14} />}
            </button>)}
            {!mutedConversations.length ? <span className="chat-message-settings-empty">当前没有免打扰会话。</span> : null}
          </div>
          <footer>
            <button disabled={Boolean(messageSettingsBusyKey)} onClick={() => void resetMessagePreferences()} type="button">
              {messageSettingsBusyKey === "reset" ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : <RotateCcw aria-hidden="true" size={14} />}
              恢复默认
            </button>
          </footer>
        </section> : null}
        <div className={`chat-dock-body${isMobileConversationOpen ? " mobile-conversation-open" : ""}`}>
          <aside className="chat-dock-sidebar">
            <div className="chat-dock-sidebar-content">
              <label className="chat-friend-search">
                <Search aria-hidden="true" size={15} />
                <input aria-label="搜索当前好友或群聊" onChange={(event) => setFriendSearch(event.target.value)} placeholder="搜索好友或群聊" value={friendSearch} />
                {friendSearch ? <button aria-label="清空好友搜索" onClick={() => setFriendSearch("")} type="button"><X aria-hidden="true" size={13} /></button> : null}
              </label>
              {isLoading ? <span className="chat-state">正在读取。</span> : null}
              <div className="chat-unified-list">
                {primaryEntries.map((entry) => entry.kind === "notification" ? (() => {
                  const items = channelNotifications[entry.config.channel];
                  const unreadCount = items.filter((item) => !item.readAt).length;
                  const pushEnabled = notificationChannelStateMap.get(entry.config.channel)?.pushEnabled ?? true;
                  const active = selectedId === entry.id;
                  return <div className={`chat-sidebar-notification-row${active ? " active" : ""}`} key={entry.id}>
                    <button className={active ? "chat-sidebar-primary-row active system-conversation" : "chat-sidebar-primary-row system-conversation"} onClick={() => { setOpenNotificationChannelMenuId(0); setSelectedId(entry.id); setSelectedSystemNotificationId(0); setIsMobileConversationOpen(true); }} type="button">
                      <span className={`chat-system-avatar ${entry.config.channel}`}><NotificationChannelIcon channel={entry.config.channel} size={17} /></span>
                      <span><strong>{entry.config.label}{!pushEnabled ? <BellOff aria-hidden="true" className="chat-muted-inline" size={13} /> : null}</strong><small>{items[0]?.body ?? entry.config.empty}</small></span>
                      {unreadCount && pushEnabled ? <b>{formatCount(unreadCount)}</b> : null}
                    </button>
                    <span className="chat-notification-channel-action" data-chat-notification-action>
                      <button aria-expanded={openNotificationChannelMenuId === entry.id} aria-label={`${entry.config.label}管理`} onClick={(event) => { event.stopPropagation(); setOpenNotificationChannelMenuId((current) => current === entry.id ? 0 : entry.id); }} title="频道管理" type="button"><MoreHorizontal aria-hidden="true" size={16} /></button>
                      {isDesktop && openNotificationChannelMenuId === entry.id ? <span className="chat-notification-channel-menu">
                        <button className="danger" onClick={() => requestNotificationChannelHide(entry.config.channel, entry.id, entry.config.label)} type="button"><Trash2 aria-hidden="true" size={14} />删除频道通知</button>
                        {items.length ? <button className="danger" onClick={() => requestNotificationChannelClear(entry.config.channel, entry.config.label)} type="button"><Eraser aria-hidden="true" size={14} />清空当前频道</button> : null}
                      </span> : null}
                    </span>
                  </div>;
                })() : entry.conversation.group ? <ChatSidebarGroupRow
                  active={entry.conversation.id === selectedId}
                  conversation={entry.conversation}
                  key={entry.conversation.id}
                  menuOpen={openFriendActionId === -1_000_000 - entry.conversation.group.id}
                  onConversationAction={(action) => {
                    setSelectedId(entry.conversation.id);
                    setPendingConversationAction(action);
                    setOpenFriendActionId(0);
                  }}
                  onManage={() => { setOpenFriendActionId(0); setGroupManagerInitialId(entry.conversation.group!.id); setGroupManagerInitialView("mine"); setIsGroupManagerOpen(true); }}
                  onOpen={() => { setSelectedId(entry.conversation.id); setIsMobileConversationOpen(true); }}
                  onToggleMenu={() => setOpenFriendActionId((current) => current === -1_000_000 - entry.conversation.group!.id ? 0 : -1_000_000 - entry.conversation.group!.id)}
                  onToggleMute={(muted) => void toggleConversationMute(entry.conversation, muted)}
                /> : <ChatSidebarContactRow
                  active={entry.conversation.id === selectedId}
                  friendship={friendshipByUserId.get(entry.conversation.user.id) ?? null}
                  key={entry.conversation.id}
                  menuOpen={openFriendActionId === (friendshipByUserId.get(entry.conversation.user.id)?.id ?? -entry.conversation.user.id)}
                  onAction={(friendship, action) => { setPendingFriendAction({ friendship, action }); setOpenFriendActionId(0); }}
                  onConversationAction={(action) => {
                    setSelectedId(entry.conversation.id);
                    setPendingConversationAction(action);
                    setOpenFriendActionId(0);
                  }}
                  onToggleMute={(muted) => void toggleConversationMute(entry.conversation, muted)}
                  onOpen={() => { setSelectedId(entry.conversation.id); setIsMobileConversationOpen(true); }}
                  onViewProfile={() => { setOpenFriendActionId(0); router.push(`/users/${encodeURIComponent(entry.conversation.user.username)}`); }}
                  onToggleMenu={(friendshipId) => setOpenFriendActionId((current) => current === friendshipId ? 0 : friendshipId)}
                  preview={getConversationPreview(entry.conversation)}
                  muted={entry.conversation.muted}
                  unreadCount={entry.conversation.unreadCount}
                  user={entry.conversation.user}
                />)}

                {filteredFriendsWithoutConversation.map((friendship) => (
                  <ChatSidebarContactRow
                    active={false}
                    friendship={friendship}
                    key={`friend-${friendship.id}`}
                    menuOpen={openFriendActionId === friendship.id}
                    onAction={(target, action) => { setPendingFriendAction({ friendship: target, action }); setOpenFriendActionId(0); }}
                    onOpen={() => void openFriendChat(friendship)}
                    onViewProfile={() => { setOpenFriendActionId(0); router.push(`/users/${encodeURIComponent(friendship.user.username)}`); }}
                    onToggleMenu={(friendshipId) => setOpenFriendActionId((current) => current === friendshipId ? 0 : friendshipId)}
                    preview="开始聊天"
                    muted={false}
                    unreadCount={0}
                    user={friendship.user}
                  />
                ))}

                {friendships.blocked.length ? <details className="chat-blocked-list">
                  <summary><Ban aria-hidden="true" size={14} />黑名单 <b>{friendships.blocked.length}</b></summary>
                  {friendships.blocked.map((friendship) => <div className="chat-blocked-row" key={friendship.id}><UserAvatar user={friendship.user} /><span><strong>{friendship.user.nickname}</strong><small>@{friendship.user.username}</small></span><button onClick={() => void handleUnblock(friendship)} title="解除拉黑" type="button"><ShieldOff aria-hidden="true" size={15} /></button></div>)}
                </details> : null}

                {!isLoading && normalizedFriendSearch && !primaryEntries.length && !filteredFriendsWithoutConversation.length ? <span className="chat-sidebar-empty">没有找到匹配的好友。</span> : null}
                {!isLoading && !normalizedFriendSearch && !primaryEntries.length && !friendships.friends.length ? <span className="chat-sidebar-empty">还没有好友或会话。</span> : null}
              </div>
            </div>
          </aside>
          <main className={`chat-panel${isNotificationSelected ? " system-selected" : ""}`}>
            {selectedNotificationConfig ? <NotificationPanel
              channel={selectedNotificationConfig.channel}
              emptyText={selectedNotificationConfig.empty}
              isActionRunning={isNotificationActionRunning}
              isSelectionMode={isNotificationSelectionMode}
              notifications={selectedNotifications}
              onCancelSelection={cancelNotificationSelection}
              onDeleteSelected={() => requestNotificationDeletion(Array.from(selectedNotificationIds))}
              onMarkSelectedRead={() => void markNotificationSelectionRead(Array.from(selectedNotificationIds))}
              onOpenArticle={(slug) => router.push(`/articles/${slug}`)}
              onOpenGroup={(groupId) => { setGroupManagerInitialId(groupId); setGroupManagerInitialView("mine"); setIsGroupManagerOpen(true); }}
              onOpenProfile={(username) => router.push(`/users/${encodeURIComponent(username)}`)}
              onPreview={setPreviewAttachment}
              onGroupAction={(notification, action) => void handleGroupNotificationAction(notification, action)}
              onOpenActions={openNotificationActionsAtPointer}
              onSelect={handleNotification}
              onToggleActions={toggleMobileNotificationActions}
              onToggleSelection={toggleNotificationSelection}
              selectedId={selectedSystemNotificationId}
              selectedIds={selectedNotificationIds}
              listRef={systemMessageListRef}
            /> : selected ? <>
              <div className="chat-message-list" onScroll={handleMessageListScroll} ref={messageListRef}>
                {isOlderMessagesLoading ? <span className="chat-load-older"><LoaderCircle aria-hidden="true" className="spin" size={14} />正在读取更早消息</span> : null}
                {isMessagesLoading ? <span className="chat-state">正在读取聊天记录。</span> : messages.map((message) => (
                  <ChatMessageItem
                    key={message.id}
                    message={message}
                    mine={message.sender.id === user.id}
                    onCall={() => callFromMessage(message)}
                    onGreeting={() => void sendQuickMessage("你好")}
                    onPreview={setPreviewAttachment}
                    onOpenActions={(event) => openMessageActionsAtPointer(message.id, event)}
                    onLongPressActions={() => openMobileMessageActions(message.id)}
                    onToggleSelection={() => toggleMessageSelection(message.id)}
                    selected={selectedMessageIds.has(message.id)}
                    selectionMode={isMessageSelectionMode}
                    longPressActionsEnabled={!isDesktop}
                    showReadReceipt={selected.kind === "direct"}
                  />
                ))}
              </div>
              {isMessageSelectionMode ? <div className="chat-message-selection-bar">
                <button onClick={cancelMessageSelection} type="button">取消</button>
                <strong>已选择 {selectedMessageIds.size} 条</strong>
                <button disabled={!selectedMessagesCanForward || isMessageActionRunning} onClick={() => openMessageForward(Array.from(selectedMessageIds))} title={selectedMessagesCanForward ? "逐条转发所选消息" : "系统消息不能转发"} type="button"><Forward aria-hidden="true" size={15} />转发</button>
                <button disabled={!selectedMessageIds.size || isMessageActionRunning} onClick={() => requestSelectedMessageDeletion("self")} type="button"><Trash2 aria-hidden="true" size={15} />删除</button>
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
                  <input accept=".jpg,.jpeg,.png,.webp,.webm,.m4a,.mp3,.wav,.ogg,.mp4,.mov,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.json,.xml,.rtf,.zip,.rar,.7z,.gz,.tar" hidden multiple onChange={(event) => { handleSelectedFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} ref={fileInputRef} type="file" />
                  <div className="chat-composer-tools">
                    {!isDesktop ? <button aria-label="更多聊天功能" className={`chat-mobile-more${isMobileToolsOpen ? " active" : ""}`} onClick={() => { setIsMobileToolsOpen((current) => !current); setIsEmojiOpen(false); }} title="更多" type="button"><Plus aria-hidden="true" size={19} /></button> : null}
                    <button aria-label="添加表情" className={`chat-desktop-tool${isEmojiOpen ? " active" : ""}`} onClick={() => { setIsEmojiOpen((current) => !current); setIsMobileToolsOpen(false); }} title="表情" type="button"><Laugh aria-hidden="true" size={18} /></button>
                    <button aria-label="添加图片或文件" className="chat-desktop-tool" onClick={() => fileInputRef.current?.click()} title="添加图片或文件" type="button"><Paperclip aria-hidden="true" size={18} /></button>
                  </div>
                  <textarea aria-label={`给 ${selected.group?.name ?? selected.user.nickname} 发消息`} maxLength={2000} onChange={(event) => updateDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} onPaste={handlePaste} placeholder="输入消息" rows={2} value={draft} />
                  <button
                    aria-label={isVoiceRecording ? `松开发送语音，已录制 ${formatDuration(voiceRecordingSeconds)}` : "发送消息，长按录制语音"}
                    className={isVoiceRecording ? "recording" : undefined}
                    disabled={isSending || Boolean(chatCalls.state)}
                    onClick={(event) => { if (suppressSendClickRef.current || (!draft.trim() && !pendingAttachments.length)) event.preventDefault(); suppressSendClickRef.current = false; }}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerCancel={handleSendPointerCancel}
                    onPointerDown={handleSendPointerDown}
                    onPointerUp={handleSendPointerUp}
                    title={isVoiceRecording ? `松开发送 ${formatDuration(voiceRecordingSeconds)}` : "发送，长按录音"}
                    type="submit"
                  >{isSending ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : isVoiceRecording ? <Square aria-hidden="true" size={15} /> : <Send aria-hidden="true" size={18} />}</button>
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
        {actionMessage && !isMessageSelectionMode ? <span className={`chat-message-action-menu${messageActionPosition ? " context-positioned" : ""}`} data-chat-message-action style={messageActionStyle}>
          <button onClick={() => beginMessageSelection(actionMessage.id)} type="button"><Check aria-hidden="true" size={14} />选择</button>
          {actionMessage.body ? <button onClick={() => void copyMessageBody(actionMessage)} type="button"><Copy aria-hidden="true" size={14} />复制</button> : null}
          {actionMessage.type !== "system" ? <button onClick={() => openMessageForward([actionMessage.id])} type="button"><Forward aria-hidden="true" size={14} />转发</button> : null}
          {selected?.group && actionMessage.sender.id !== user.id && actionMessage.type !== "system" ? <button onClick={() => { setPendingGroupReportMessageId(actionMessage.id); setOpenMessageActionId(0); setGroupReportReason("spam"); setGroupReportDetail(""); }} type="button"><Flag aria-hidden="true" size={14} />举报</button> : null}
          {actionMessage.sender.id === user.id && actionMessage.type !== "system" && messageActionOpenedAt - timestamp(actionMessage.createdAt) <= 2 * 60 * 1000
            ? <button onClick={() => requestMessageOperation("recall", actionMessage.id)} type="button"><Undo2 aria-hidden="true" size={14} />撤回消息</button>
            : null}
          <button onClick={() => requestMessageOperation("delete-self", actionMessage.id)} type="button"><Trash2 aria-hidden="true" size={14} />删除</button>
          <button className="danger" onClick={() => requestMessageOperation("delete-everyone", actionMessage.id)} type="button"><Trash2 aria-hidden="true" size={14} />双向删除</button>
        </span> : null}
        {actionNotification && !isNotificationSelectionMode ? <span className={`chat-notification-action-menu${notificationActionPosition ? " context-positioned" : ""}`} data-chat-notification-action style={notificationActionStyle}>
          <button onClick={() => beginNotificationSelection(actionNotification.id)} type="button"><Check aria-hidden="true" size={14} />选择</button>
          {!actionNotification.readAt ? <button onClick={() => void markNotificationSelectionRead([actionNotification.id])} type="button"><Bell aria-hidden="true" size={14} />标为已读</button> : null}
          <button className="danger" onClick={() => requestNotificationDeletion([actionNotification.id])} type="button"><Trash2 aria-hidden="true" size={14} />删除通知</button>
        </span> : null}
        {pendingGroupReportMessageId ? <div className="chat-confirm-backdrop" onClick={() => { if (!isMessageActionRunning) setPendingGroupReportMessageId(0); }} role="presentation"><div aria-modal="true" className="chat-add-friend-dialog chat-group-report-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><header><span><Flag aria-hidden="true" size={18} /><strong>举报群消息</strong></span><button aria-label="关闭举报窗口" onClick={() => setPendingGroupReportMessageId(0)} type="button"><X aria-hidden="true" size={17} /></button></header><div className="chat-group-report-form"><label><span>举报原因</span><select onChange={(event) => setGroupReportReason(event.target.value)} value={groupReportReason}><option value="spam">垃圾广告</option><option value="harassment">骚扰攻击</option><option value="illegal">违法违规</option><option value="privacy">泄露隐私</option><option value="misinformation">虚假信息</option><option value="other">其他</option></select></label><label><span>补充说明</span><textarea maxLength={300} onChange={(event) => setGroupReportDetail(event.target.value)} placeholder="可选，帮助管理员更快判断" rows={3} value={groupReportDetail} /></label><footer><button disabled={isMessageActionRunning} onClick={() => setPendingGroupReportMessageId(0)} type="button">取消</button><button disabled={isMessageActionRunning} onClick={() => void submitGroupReport()} type="button">{isMessageActionRunning ? "提交中" : "提交举报"}</button></footer></div></div></div> : null}
        {pendingMessageForward ? <div className="chat-confirm-backdrop" onClick={() => { if (!isForwardingMessages) setPendingMessageForward(null); }} role="presentation">
          <div aria-modal="true" className="chat-add-friend-dialog chat-forward-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <header><span><Forward aria-hidden="true" size={18} /><strong>选择转发对象</strong></span><button aria-label="关闭转发窗口" disabled={isForwardingMessages} onClick={() => setPendingMessageForward(null)} type="button"><X aria-hidden="true" size={17} /></button></header>
            <label className="chat-user-search"><Search aria-hidden="true" size={16} /><input autoFocus maxLength={40} onChange={(event) => setForwardTargetSearch(event.target.value)} placeholder="搜索好友" value={forwardTargetSearch} />{forwardTargetSearch ? <button aria-label="清空好友搜索" onClick={() => setForwardTargetSearch("")} type="button"><X aria-hidden="true" size={13} /></button> : null}</label>
            <div className="chat-forward-target-list">
              {forwardTargets.map((friendship) => <button disabled={isForwardingMessages} key={friendship.id} onClick={() => void forwardMessagesTo(friendship)} type="button"><UserAvatar user={friendship.user} /><span><strong>{friendship.user.nickname}<RoleSymbol code={friendship.user.isSuperAdmin ? "super_administrator" : friendship.user.role.code} /></strong><small>@{friendship.user.username}</small></span><Forward aria-hidden="true" size={15} /></button>)}
              {!forwardTargets.length ? <span className="chat-sidebar-empty">没有可转发的好友。</span> : null}
            </div>
            <small className="chat-forward-hint">将按原顺序逐条转发 {pendingMessageForward.messageIds.length} 条消息。</small>
          </div>
        </div> : null}
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
        {pendingConversationAction ? <div className="chat-confirm-backdrop" onClick={() => { if (!isConversationActionRunning) setPendingConversationAction(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon">{pendingConversationAction === "clear" ? <Eraser aria-hidden="true" size={20} /> : <Trash2 aria-hidden="true" size={20} />}</span><div><strong>{pendingConversationAction === "clear" ? "清空当前聊天记录" : "从聊天列表删除会话"}</strong><p>{pendingConversationAction === "clear" ? "当前账号中的系统消息、文字、图片和文件记录都会被清空，会话入口和好友关系保留。" : "当前账号中的系统消息和全部聊天内容都会被清空，并从聊天列表移除；好友关系保留，可重新发起空会话。"}</p></div><footer><button disabled={isConversationActionRunning} onClick={() => setPendingConversationAction(null)} type="button">取消</button><button className="danger" disabled={isConversationActionRunning} onClick={() => void executeConversationAction()} type="button">{isConversationActionRunning ? "处理中" : "确认"}</button></footer></div></div> : null}
        {pendingMessageOperation ? <div className="chat-confirm-backdrop" onClick={() => { if (!isMessageActionRunning) setPendingMessageOperation(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon">{pendingMessageOperation.operation === "recall" ? <Undo2 aria-hidden="true" size={20} /> : <Trash2 aria-hidden="true" size={20} />}</span><div><strong>{pendingMessageOperation.operation === "recall" ? "撤回这条消息" : pendingMessageOperation.operation === "delete-everyone" ? `双向删除 ${pendingMessageOperation.messageIds.length} 条消息` : `删除 ${pendingMessageOperation.messageIds.length} 条消息`}</strong><p>{pendingMessageOperation.operation === "recall" ? "原消息和附件会被物理删除，双方聊天中会保留一条撤回提示。" : pendingMessageOperation.operation === "delete-everyone" ? "消息会从双方记录中永久删除，关联附件也会从磁盘删除，操作无法恢复。" : "这些消息只会从当前账号隐藏，对方仍然可以查看。"}</p></div><footer><button disabled={isMessageActionRunning} onClick={() => setPendingMessageOperation(null)} type="button">取消</button><button className="danger" disabled={isMessageActionRunning} onClick={() => void executeMessageOperation()} type="button">{isMessageActionRunning ? "处理中" : "确认"}</button></footer></div></div> : null}
        {pendingNotificationDeletion ? <div className="chat-confirm-backdrop" onClick={() => { if (!isNotificationActionRunning) setPendingNotificationDeletion(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon"><Trash2 aria-hidden="true" size={20} /></span><div><strong>{pendingNotificationDeletion.channel ? `清空${pendingNotificationDeletion.channelLabel}` : `删除 ${pendingNotificationDeletion.notificationIds.length} 条通知`}</strong><p>{pendingNotificationDeletion.channel ? "当前频道中显示的通知会从该账号永久删除，待处理好友申请不会受影响。" : "所选通知会从当前账号永久删除，操作无法恢复。"}</p></div><footer><button disabled={isNotificationActionRunning} onClick={() => setPendingNotificationDeletion(null)} type="button">取消</button><button className="danger" disabled={isNotificationActionRunning} onClick={() => void executeNotificationDeletion()} type="button">{isNotificationActionRunning ? "处理中" : "确认删除"}</button></footer></div></div> : null}
        {pendingNotificationChannelHide ? <div className="chat-confirm-backdrop" onClick={() => { if (!isNotificationActionRunning) setPendingNotificationChannelHide(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon"><Trash2 aria-hidden="true" size={20} /></span><div><strong>从消息列表删除{pendingNotificationChannelHide.channelLabel}</strong><p>频道会从当前账号的消息列表隐藏，已有通知不会删除；收到新的频道通知后会自动重新显示。</p></div><footer><button disabled={isNotificationActionRunning} onClick={() => setPendingNotificationChannelHide(null)} type="button">取消</button><button className="danger" disabled={isNotificationActionRunning} onClick={() => void executeNotificationChannelHide()} type="button">{isNotificationActionRunning ? "处理中" : "确认删除"}</button></footer></div></div> : null}
        <button aria-label="调整聊天窗大小" className="chat-dock-resize-handle" onPointerDown={beginDockResize} tabIndex={-1} type="button" />
      </section>
      {isGroupManagerOpen && readAccessToken() ? <ChatGroupManager
        accessToken={readAccessToken()!}
        friendships={friendships.friends}
        initialGroupId={groupManagerInitialId}
        initialView={groupManagerInitialView}
        onChanged={refreshSocialData}
        onClose={() => setIsGroupManagerOpen(false)}
        onOpenConversation={(conversationId) => { setSelectedId(conversationId); setIsMobileConversationOpen(true); setIsGroupManagerOpen(false); void refreshSocialData(); }}
      /> : null}
      {!isDesktop && openNotificationChannel && typeof document !== "undefined" ? createPortal(
        <div className="chat-mobile-channel-sheet" data-chat-notification-action>
          <button className="danger" onClick={() => requestNotificationChannelHide(openNotificationChannel.channel, openNotificationChannel.id, openNotificationChannel.label)} type="button"><Trash2 aria-hidden="true" size={15} />删除频道通知</button>
          {openNotificationChannelItems.length ? <button className="danger" onClick={() => requestNotificationChannelClear(openNotificationChannel.channel, openNotificationChannel.label)} type="button"><Eraser aria-hidden="true" size={15} />清空当前频道</button> : null}
        </div>,
        document.body,
      ) : null}
      {previewAttachment ? <AttachmentPreview attachment={previewAttachment} onClose={closeAttachmentPreview} /> : null}
      {callPanel}
      <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </>
  );
}

function ChatSidebarContactRow({ active, friendship, menuOpen, muted, preview, unreadCount, user, onAction, onConversationAction, onOpen, onToggleMenu, onToggleMute, onViewProfile }: {
  active: boolean;
  friendship: Friendship | null;
  menuOpen: boolean;
  muted: boolean;
  preview: string;
  unreadCount: number;
  user: SocialUser;
  onAction: (friendship: Friendship, action: "remove" | "block") => void;
  onConversationAction?: (action: ConversationAction) => void;
  onToggleMute?: (muted: boolean) => void;
  onOpen: () => void;
  onToggleMenu: (friendshipId: number) => void;
  onViewProfile: () => void;
}) {
  return <div className={`chat-sidebar-contact-row${active ? " active" : ""}`}>
    <button className="chat-sidebar-primary-row" onClick={onOpen} type="button">
      <UserAvatar user={user} />
      <span><strong className="chat-conversation-name">{user.nickname}<RoleSymbol code={user.isSuperAdmin ? "super_administrator" : user.role.code} />{muted ? <BellOff aria-hidden="true" className="chat-muted-inline" size={13} /> : null}</strong><small>{preview}</small></span>
      {unreadCount ? <b className={muted ? "muted" : undefined}>{muted ? "" : formatCount(unreadCount)}</b> : null}
    </button>
    {friendship || onConversationAction ? <div className="chat-friend-action" data-chat-friend-action>
      <button aria-expanded={menuOpen} aria-label={`${user.nickname} 的聊天管理`} className="chat-friend-action-trigger" onClick={(event) => { event.stopPropagation(); onToggleMenu(friendship?.id ?? -user.id); }} title="聊天管理" type="button"><MoreHorizontal aria-hidden="true" size={16} /></button>
      {menuOpen ? <div className="chat-friend-action-menu">
        {friendship ? <>
          <button onClick={onViewProfile} type="button"><UserRound aria-hidden="true" size={15} />查看主页</button>
          <button onClick={() => onAction(friendship, "remove")} type="button"><UserMinus aria-hidden="true" size={15} />删除好友</button>
          <button onClick={() => onAction(friendship, "block")} type="button"><Ban aria-hidden="true" size={15} />拉黑好友</button>
        </> : null}
        {onConversationAction ? <>
          {friendship ? <span className="chat-friend-action-menu-divider" /> : null}
          {onToggleMute ? <button onClick={() => onToggleMute(!muted)} type="button">{muted ? <Bell aria-hidden="true" size={15} /> : <BellOff aria-hidden="true" size={15} />}{muted ? "关闭免打扰" : "消息免打扰"}</button> : null}
          <button onClick={() => onConversationAction("clear")} type="button"><Eraser aria-hidden="true" size={15} />清空聊天</button>
          <button className="danger" onClick={() => onConversationAction("delete")} type="button"><Trash2 aria-hidden="true" size={15} />删除聊天</button>
        </> : null}
      </div> : null}
    </div> : null}
  </div>;
}

function ChatSidebarGroupRow({ active, conversation, menuOpen, onConversationAction, onManage, onOpen, onToggleMenu, onToggleMute }: {
  active: boolean;
  conversation: Conversation;
  menuOpen: boolean;
  onConversationAction: (action: ConversationAction) => void;
  onManage: () => void;
  onOpen: () => void;
  onToggleMenu: () => void;
  onToggleMute: (muted: boolean) => void;
}) {
  const group = conversation.group!;
  return <div className={`chat-sidebar-contact-row chat-sidebar-group-row${active ? " active" : ""}`}>
    <button className="chat-sidebar-primary-row" onClick={onOpen} type="button">
      <ConversationAvatar conversation={conversation} />
      <span><strong className="chat-conversation-name"><Users aria-hidden="true" className="chat-group-inline-mark" size={13} />{group.name}{group.temporary ? <Clock3 aria-hidden="true" className="chat-muted-inline" size={13} /> : null}{conversation.muted ? <BellOff aria-hidden="true" className="chat-muted-inline" size={13} /> : null}</strong><small>{getConversationPreview(conversation)}</small></span>
      <span className="chat-group-pending-badges">{group.pendingJoinRequestCount ? <b title="待处理入群申请"><UserPlus aria-hidden="true" size={11} />{formatCount(group.pendingJoinRequestCount)}</b> : null}{group.pendingReportCount ? <b className="report" title="待处理举报"><Flag aria-hidden="true" size={11} />{formatCount(group.pendingReportCount)}</b> : null}{conversation.unreadCount ? <b className={conversation.muted ? "muted" : undefined}>{conversation.muted ? "" : formatCount(conversation.unreadCount)}</b> : null}</span>
    </button>
    <div className="chat-friend-action" data-chat-friend-action>
      <button aria-expanded={menuOpen} aria-label={`${group.name} 的群聊管理`} className="chat-friend-action-trigger" onClick={(event) => { event.stopPropagation(); onToggleMenu(); }} title="群聊管理" type="button"><MoreHorizontal aria-hidden="true" size={16} /></button>
      {menuOpen ? <div className="chat-friend-action-menu">
        <button onClick={onManage} type="button"><Users aria-hidden="true" size={15} />群资料与成员</button>
        <span className="chat-friend-action-menu-divider" />
        <button onClick={() => onToggleMute(!conversation.muted)} type="button">{conversation.muted ? <Bell aria-hidden="true" size={15} /> : <BellOff aria-hidden="true" size={15} />}{conversation.muted ? "关闭免打扰" : "消息免打扰"}</button>
        <button onClick={() => onConversationAction("clear")} type="button"><Eraser aria-hidden="true" size={15} />清空聊天</button>
        <button className="danger" onClick={() => onConversationAction("delete")} type="button"><Trash2 aria-hidden="true" size={15} />删除聊天</button>
      </div> : null}
    </div>
  </div>;
}

function ConversationAvatar({ conversation }: { conversation: Conversation }) {
  if (!conversation.group) return <UserAvatar user={conversation.user} />;
  return <span className="chat-user-avatar chat-group-conversation-avatar">{conversation.group.avatarUrl
    ? <img alt="" src={resolveApiUrl(conversation.group.avatarUrl)} />
    : Array.from(conversation.group.name.trim()).slice(-2).join("").toUpperCase()}</span>;
}

function NotificationPanel({
  channel,
  emptyText,
  isActionRunning,
  isSelectionMode,
  notifications,
  selectedId,
  selectedIds,
  listRef,
  onCancelSelection,
  onDeleteSelected,
  onMarkSelectedRead,
  onOpenActions,
  onOpenArticle,
  onOpenGroup,
  onOpenProfile,
  onPreview,
  onGroupAction,
  onSelect,
  onToggleActions,
  onToggleSelection,
}: {
  channel: NotificationChannel;
  emptyText: string;
  isActionRunning: boolean;
  isSelectionMode: boolean;
  notifications: SocialNotification[];
  selectedId: number;
  selectedIds: Set<number>;
  listRef: RefObject<HTMLDivElement | null>;
  onCancelSelection: () => void;
  onDeleteSelected: () => void;
  onMarkSelectedRead: () => void;
  onOpenActions: (notificationId: number, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenArticle: (slug: string) => void;
  onOpenGroup: (groupId: number) => void;
  onOpenProfile: (username: string) => void;
  onPreview: (attachment: ChatAttachment) => void;
  onGroupAction: (notification: SocialNotification, action: "accept" | "reject" | "resolve-report" | "reject-report") => void;
  onSelect: (notification: SocialNotification) => Promise<void>;
  onToggleActions: (notificationId: number) => void;
  onToggleSelection: (notificationId: number) => void;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredIdRef = useRef(0);
  const selectedUnopenedCount = notifications.filter((notification) => selectedIds.has(notification.id) && !notification.openedAt).length;
  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    longPressOriginRef.current = null;
  }
  useEffect(() => () => clearLongPressTimer(), []);
  function handlePointerDown(notificationId: number, event: ReactPointerEvent<HTMLElement>) {
    longPressTriggeredIdRef.current = 0;
    if (isSelectionMode || event.pointerType === "mouse" || event.button !== 0) return;
    clearLongPressTimer();
    longPressOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressTriggeredIdRef.current = notificationId;
      onToggleActions(notificationId);
    }, 520);
  }
  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const origin = longPressOriginRef.current;
    if (!origin || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= 10) return;
    clearLongPressTimer();
  }
  function handlePointerEnd() {
    clearLongPressTimer();
  }
  return <div className={`chat-system-panel${isSelectionMode ? " selection-mode" : ""}`}>
    <div className="chat-system-message-list" ref={listRef}>
      {notifications.length ? notifications.map((notification) => {
        const selected = selectedIds.has(notification.id);
        function handleSelectionClick(event: ReactMouseEvent<HTMLElement>) {
          if (longPressTriggeredIdRef.current === notification.id) {
            longPressTriggeredIdRef.current = 0;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!isSelectionMode) return;
          if ((event.target as HTMLElement).closest(".chat-notification-selector")) return;
          event.preventDefault();
          event.stopPropagation();
          onToggleSelection(notification.id);
        }
        function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
          event.preventDefault();
          event.stopPropagation();
          clearLongPressTimer();
          if (isSelectionMode) onToggleSelection(notification.id);
          else if (longPressTriggeredIdRef.current !== notification.id) onOpenActions(notification.id, event);
        }
        return <article
          className={`${notification.openedAt ? "" : "unopened"}${selectedId === notification.id ? " selected" : ""}${isSelectionMode ? " selection-mode" : ""}${selected ? " batch-selected" : ""}`}
          data-notification-id={notification.id}
          key={notification.id}
          onClickCapture={handleSelectionClick}
          onContextMenu={handleContextMenu}
          onPointerCancel={handlePointerEnd}
          onPointerDown={(event) => handlePointerDown(notification.id, event)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
        >
          {isSelectionMode ? <button aria-label={selected ? "取消选择通知" : "选择通知"} aria-pressed={selected} className="chat-notification-selector" onClick={() => onToggleSelection(notification.id)} type="button">{selected ? <Check aria-hidden="true" size={13} /> : null}</button> : null}
          <div className="chat-system-notification-card">
            <NotificationIdentity notification={notification} onOpenGroup={onOpenGroup} onOpenProfile={onOpenProfile} />
            <div className="chat-system-notification-main">
              <button className="chat-system-notification-copy" onClick={() => void onSelect(notification)} type="button"><span>
                <strong>{notification.title}</strong>
                {notification.context?.group?.name ? <small className="chat-notification-group-name">{notification.context.group.name}</small> : null}
                {notification.context?.kind !== "group_report" ? <small>{notification.context?.kind === "friend_request" && notification.context.requestNote ? notification.context.requestNote : notification.body}</small> : null}
                {notification.context?.commentBody ? <q>{notification.context.commentBody}</q> : null}
                {notification.context && !notification.context.actionable && notification.context.status ? <em>{notificationStatusLabel(notification.context.kind, notification.context.status)}</em> : null}
                <time>{formatChatTime(notification.updatedAt || notification.createdAt)}</time>
              </span></button>
              {notification.context?.kind === "group_report" && notification.context.message ? <NotificationReportContent message={notification.context.message} onPreview={onPreview} /> : null}
            </div>
            {notification.context?.actionable && (notification.context.kind === "friend_request" || notification.context.kind === "group_invitation" || notification.context.kind === "group_join_request") ? <div className="chat-notification-inline-actions"><button disabled={isActionRunning} onClick={() => onGroupAction(notification, "accept")} type="button"><Check aria-hidden="true" size={13} />同意</button><button disabled={isActionRunning} onClick={() => onGroupAction(notification, "reject")} type="button"><X aria-hidden="true" size={13} />拒绝</button></div> : null}
            {notification.context?.actionable && notification.context.kind === "group_report" ? <div className="chat-notification-inline-actions"><button disabled={isActionRunning} onClick={() => onGroupAction(notification, "resolve-report")} type="button"><Check aria-hidden="true" size={13} />处理</button><button disabled={isActionRunning} onClick={() => onGroupAction(notification, "reject-report")} type="button"><X aria-hidden="true" size={13} />驳回</button></div> : null}
          </div>
          {notification.context?.article ? <button className="chat-system-article-link" onClick={() => onOpenArticle(notification.context?.article?.slug ?? "")} type="button"><FileText aria-hidden="true" size={15} /><span><small>相关文章</small><strong>{notification.context.article.title}</strong></span><ChevronLeft aria-hidden="true" size={15} /></button> : null}
        </article>;
      }) : <div className="chat-empty"><NotificationChannelIcon channel={channel} size={26} /><strong>暂时没有消息</strong><span>{emptyText}</span></div>}
    </div>
    {isSelectionMode ? <div className="chat-message-selection-bar chat-notification-selection-bar">
      <button disabled={isActionRunning} onClick={onCancelSelection} type="button"><X aria-hidden="true" size={14} />取消</button>
      <strong>已选 {selectedIds.size} 条</strong>
      <button disabled={isActionRunning || !selectedUnopenedCount} onClick={onMarkSelectedRead} type="button"><Bell aria-hidden="true" size={14} />标为已读</button>
      <button className="danger" disabled={isActionRunning || !selectedIds.size} onClick={onDeleteSelected} type="button"><Trash2 aria-hidden="true" size={14} />删除</button>
    </div> : null}
  </div>;
}

function NotificationIdentity({
  notification,
  onOpenGroup,
  onOpenProfile,
}: {
  notification: SocialNotification;
  onOpenGroup: (groupId: number) => void;
  onOpenProfile: (username: string) => void;
}) {
  const group = notification.context?.group;
  const useGroup = Boolean(group && (notification.context?.kind === "group_invitation" || notification.context?.kind === "group_report"));
  if (useGroup && group) {
    return <button aria-label={`查看群聊 ${group.name}`} className="chat-notification-identity" onClick={() => onOpenGroup(group.id)} title="查看群资料" type="button"><span className="chat-user-avatar chat-group-conversation-avatar">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : Array.from(group.name.trim()).slice(-2).join("").toUpperCase()}</span></button>;
  }
  if (notification.actor) {
    return <button aria-label={`查看 ${notification.actor.nickname} 的主页`} className="chat-notification-identity" onClick={() => onOpenProfile(notification.actor!.username)} title="查看主页" type="button"><UserAvatar user={notification.actor} /></button>;
  }
  return <span className="chat-system-notification-icon"><NotificationChannelIcon channel={notification.channel} size={17} /></span>;
}

function NotificationReportContent({ message, onPreview }: { message: ChatMessage; onPreview: (attachment: ChatAttachment) => void }) {
  const images = message.attachments.filter((attachment) => attachment.kind === "image");
  const files = message.attachments.filter((attachment) => attachment.kind !== "image");
  return <div className="chat-notification-report-content">
    {message.body ? <q>{message.body}</q> : null}
    {images.length ? <div className={`chat-message-attachments chat-message-images count-${images.length}`}>{images.map((attachment) => <AuthenticatedImage attachment={attachment} key={attachment.id} onClick={() => onPreview(attachment)} />)}</div> : null}
    {files.length ? <div className="chat-message-attachments chat-message-files">{files.map((attachment) => attachment.kind === "audio" || attachment.kind === "video" ? <AuthenticatedMedia attachment={attachment} key={attachment.id} /> : <AttachmentFile attachment={attachment} key={attachment.id} />)}</div> : null}
  </div>;
}

function notificationStatusLabel(kind: NonNullable<SocialNotification["context"]>["kind"], status: string): string {
  if (status === "already_joined") return "您已加入该群聊";
  if (kind === "friend_request") {
    if (status === "accepted") return "好友申请已接受";
    if (status === "declined") return "好友申请已拒绝";
    if (status === "blocked") return "该好友关系已被拉黑";
    return "好友申请已失效";
  }
  if (kind === "group_report") return status === "rejected" ? "举报已驳回" : "举报已处理";
  if (status === "accepted" || status === "approved") return "已通过";
  if (status === "declined" || status === "rejected") return "已拒绝";
  if (status === "expired") return "邀请已过期";
  return "操作已失效";
}

function ChatMessageItem({
  message,
  mine,
  selected,
  selectionMode,
  onCall,
  onGreeting,
  onPreview,
  onLongPressActions,
  onOpenActions,
  onToggleSelection,
  longPressActionsEnabled,
  showReadReceipt,
}: {
  message: ChatMessage;
  mine: boolean;
  selected: boolean;
  selectionMode: boolean;
  onCall: () => void;
  onGreeting: () => void;
  onPreview: (attachment: ChatAttachment) => void;
  onLongPressActions: () => void;
  onOpenActions: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onToggleSelection: () => void;
  longPressActionsEnabled: boolean;
  showReadReceipt: boolean;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const senderLabelTimerRef = useRef<number | null>(null);
  const senderLabelHideTimerRef = useRef<number | null>(null);
  const senderLabelOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [senderLabelVisible, setSenderLabelVisible] = useState(false);
  const callType = message.type === "system" ? message.call?.type ?? inferCallType(message.body) : null;
  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    longPressOriginRef.current = null;
  }
  function clearSenderLabelTimer() {
    if (senderLabelTimerRef.current !== null) window.clearTimeout(senderLabelTimerRef.current);
    senderLabelTimerRef.current = null;
    senderLabelOriginRef.current = null;
  }
  useEffect(() => () => {
    clearLongPressTimer();
    clearSenderLabelTimer();
    if (senderLabelHideTimerRef.current !== null) window.clearTimeout(senderLabelHideTimerRef.current);
  }, []);
  function handleSenderPointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    event.stopPropagation();
    if (event.pointerType === "mouse" || event.button !== 0) return;
    clearSenderLabelTimer();
    senderLabelOriginRef.current = { x: event.clientX, y: event.clientY };
    senderLabelTimerRef.current = window.setTimeout(() => {
      senderLabelTimerRef.current = null;
      setSenderLabelVisible(true);
      if (senderLabelHideTimerRef.current !== null) window.clearTimeout(senderLabelHideTimerRef.current);
      senderLabelHideTimerRef.current = window.setTimeout(() => setSenderLabelVisible(false), 1800);
    }, 420);
  }
  function handleSenderPointerMove(event: ReactPointerEvent<HTMLSpanElement>) {
    event.stopPropagation();
    const origin = senderLabelOriginRef.current;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) clearSenderLabelTimer();
  }
  function handleSenderPointerEnd(event: ReactPointerEvent<HTMLSpanElement>) {
    event.stopPropagation();
    clearSenderLabelTimer();
  }
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!longPressActionsEnabled || selectionMode || event.pointerType === "mouse" || event.button !== 0) return;
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    longPressOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressTriggeredRef.current = true;
      onLongPressActions();
    }, 520);
  }
  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = longPressOriginRef.current;
    if (!origin || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= 10) return;
    clearLongPressTimer();
  }
  function handlePointerEnd() {
    clearLongPressTimer();
  }
  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (selectionMode) {
      onToggleSelection();
      return;
    }
    if (longPressActionsEnabled) {
      clearLongPressTimer();
      if (!longPressTriggeredRef.current) {
        longPressTriggeredRef.current = true;
        onLongPressActions();
      }
      return;
    }
    onOpenActions(event);
  }
  function handleSelectionClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (selectionMode) {
      if ((event.target as HTMLElement).closest(".chat-message-selector")) return;
      event.preventDefault();
      event.stopPropagation();
      onToggleSelection();
    }
  }
  const selectionControl = selectionMode ? <button
    aria-label={selected ? "取消选择消息" : "选择消息"}
    aria-pressed={selected}
    className="chat-message-selector"
    onClick={onToggleSelection}
    type="button"
  >{selected ? <Check aria-hidden="true" size={13} /> : null}</button> : null;

  if (message.type === "system") {
    return <div aria-selected={selectionMode ? selected : undefined} className={`chat-system-row${selectionMode ? " selection-mode" : ""}${selected ? " selected" : ""}`} onClickCapture={handleSelectionClick} onContextMenu={handleContextMenu} onPointerCancel={handlePointerEnd} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd}>
      {selectionControl}
      {callType ? <button className="chat-call-message" onClick={onCall} title={`再次发起${callType === "voice" ? "语音" : "视频"}通话`} type="button">
        {callType === "voice" ? <Phone aria-hidden="true" size={14} /> : <Video aria-hidden="true" size={14} />}
        <span>{message.body}</span>
      </button> : <span>{message.body}</span>}
      {message.body === "你们已经成为好友，可以开始聊天了。" ? <button onClick={onGreeting} type="button">打个招呼</button> : null}
      <time>{formatChatTime(message.createdAt)}</time>
    </div>;
  }
  const emojiOnly = isEmojiOnly(message.body);
  const imageAttachments = message.attachments?.filter((attachment) => attachment.kind === "image") ?? [];
  const otherAttachments = message.attachments?.filter((attachment) => attachment.kind !== "image") ?? [];
  return <div aria-selected={selectionMode ? selected : undefined} className={`chat-message ${mine ? "mine" : "theirs"}${selectionMode ? " selection-mode" : ""}${emojiOnly ? " emoji-only" : ""}${selected ? " selected" : ""}`} onClickCapture={handleSelectionClick} onContextMenu={handleContextMenu} onPointerCancel={handlePointerEnd} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd}>
    {selectionControl}
    <span
      aria-label={message.senderDisplayName || message.sender.nickname}
      className={`chat-message-sender${senderLabelVisible ? " label-visible" : ""}`}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onPointerCancel={handleSenderPointerEnd}
      onPointerDown={handleSenderPointerDown}
      onPointerMove={handleSenderPointerMove}
      onPointerUp={handleSenderPointerEnd}
      title={message.senderDisplayName || message.sender.nickname}
    ><UserAvatar user={message.sender} /><small>{message.senderDisplayName || message.sender.nickname}</small></span>
    <div>
      {imageAttachments.length ? <div className={`chat-message-attachments chat-message-images count-${imageAttachments.length}`}>{imageAttachments.map((attachment) => <AuthenticatedImage attachment={attachment} key={attachment.id} onClick={() => onPreview(attachment)} />)}</div> : null}
      {otherAttachments.length ? <div className={`chat-message-attachments chat-message-files${otherAttachments.length === 1 && otherAttachments[0].kind === "audio" ? " audio-only" : ""}`}>{otherAttachments.map((attachment) => attachment.kind === "audio" || attachment.kind === "video" ? <AuthenticatedMedia attachment={attachment} key={attachment.id} /> : <AttachmentFile attachment={attachment} key={attachment.id} />)}</div> : null}
      {message.body ? <p>{message.body}</p> : null}
      <span>{formatChatTime(message.createdAt)}{mine && showReadReceipt ? ` · ${message.readAt ? "已读" : "未读"}` : ""}</span>
    </div>
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
    ? <audio className="chat-audio-attachment" controls onEnded={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }} preload="metadata" src={url} />
    : <video className="chat-video-attachment" controls playsInline preload="metadata" src={url} />;
}

function AuthenticatedImage({ attachment, onClick }: { attachment: ChatAttachment; onClick: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    let objectUrl = "";
    downloadChatAttachmentThumbnail(token, attachment)
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

function browserPushDescription(state: BrowserPushState | null): string {
  if (!state) return "正在检查当前浏览器";
  if (!state.supported) return "当前浏览器不支持 Web Push";
  if (!state.enabled) return "服务器尚未配置推送服务";
  if (state.permission === "denied") return "通知权限已被浏览器阻止";
  if (state.subscribed) return "已在当前设备开启";
  return "关闭网页后也可接收新消息";
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
