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
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { RequestComposerDialog } from "@/components/request-composer-dialog";
import { RoleSymbol } from "@/components/role-symbol";
import { AvatarManagementBadge } from "@/components/user-identity-badges";
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
  respondStrangerMessageRequest,
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
import { localizedPath } from "@/lib/i18n";
import { notificationTitle } from "@/lib/system-labels";
import {
  type BrowserPushState,
  disableBrowserPush,
  enableBrowserPush,
  getBrowserPushState,
} from "@/lib/push-api";

const MAX_ATTACHMENTS = 9;
const NOTIFICATION_CHANNELS = [
  { channel: "system", id: -1 },
  { channel: "subscription", id: -2 },
  { channel: "interaction", id: -3 },
] as const satisfies ReadonlyArray<{ channel: NotificationChannel; id: number }>;
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
  const { locale, phrase, t } = useLanguage();
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
  const sendInFlightRef = useRef(false);
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
  const notificationChannels = useMemo(() => [
    { channel: "system" as const, id: -1, label: phrase("系统消息", "System"), empty: phrase("好友申请结果和内容处理通知会显示在这里。", "Friend request results and content-review updates appear here.") },
    { channel: "subscription" as const, id: -2, label: phrase("订阅更新", "Subscriptions"), empty: phrase("订阅作者发布的新内容会显示在这里。", "New content from subscribed authors appears here.") },
    { channel: "interaction" as const, id: -3, label: phrase("互动消息", "Interactions"), empty: phrase("点赞、收藏、评论和新订阅会显示在这里。", "Likes, favorites, comments, and new subscriptions appear here.") },
  ], [phrase]);
  const groupReportReasonOptions = useMemo(() => [
    { label: t("report.reason.spam"), value: "spam" },
    { label: t("report.reason.harassment"), value: "harassment" },
    { label: t("report.reason.illegal"), value: "illegal" },
    { label: t("report.reason.privacy"), value: "privacy" },
    { label: t("report.reason.misinformation"), value: "misinformation" },
    { label: t("report.reason.other"), value: "other" },
  ], [t]);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const selectedGroupIsBanned = Boolean(selected?.group?.isBanned);
  const selectedGroupBanNotice = selected?.group?.bannedUntil
    ? phrase(`该群已被站点封禁，预计于 ${formatMinute(selected.group.bannedUntil, locale)} 解除。`, `This group is banned by the site until ${formatMinute(selected.group.bannedUntil, locale)}.`)
    : phrase("该群已被站点永久封禁。", "This group has been permanently banned by the site.");
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
  const selectedNotificationConfig = notificationChannels.find((item) => item.id === selectedId) ?? null;
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
  const selectedMessagesCanForward = !selectedGroupIsBanned && Boolean(selectedMessageIds.size) &&
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
    ...(!normalizedFriendSearch ? notificationChannels.filter((config) => !hiddenNotificationChannels.includes(config.channel)).map((config) => ({ kind: "notification" as const, id: config.id, activityAt: channelNotifications[config.channel][0]?.updatedAt ?? channelNotifications[config.channel][0]?.createdAt ?? "", config })) : []),
  ].sort((left, right) => timestamp(right.activityAt) - timestamp(left.activityAt)), [channelNotifications, conversations, hiddenNotificationChannels, matchesConversationSearch, normalizedFriendSearch, notificationChannels]);
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
          if (active) setError(searchError instanceof Error ? searchError.message : phrase("用户搜索失败。", "Could not search users."));
        })
        .finally(() => {
          if (active) setIsUserSearching(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isAddFriendOpen, phrase, userSearch]);

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
        if (notificationChannels.some((item) => item.id === current && !nextHiddenChannels.includes(item.channel))) return current;
        if (current && conversationResult.items.some((item) => item.id === current)) return current;
        return 0;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : phrase("消息数据加载失败。", "Could not load messages."));
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [clearActiveCall, notificationChannels, phrase]);

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
        setError(openError instanceof Error ? openError.message : phrase("会话创建失败。", "Could not create conversation."));
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
  }, [phrase]);

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
        if (active) setError(actionError instanceof Error ? actionError.message : phrase("通知状态更新失败。", "Could not update notification status."));
      });
    return () => {
      active = false;
    };
  }, [isDesktop, isMinimized, isMobileConversationOpen, isOpen, phrase, selectedNotificationConfig, selectedUnreadNotifications]);

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
    socket.on("chat:error", (payload: { message?: string }) => setError(payload.message || phrase("聊天连接出现问题。", "There is a problem with the chat connection.")));
    socket.on("chat:reauthenticate", () => {
      void (async () => {
        const session = await refreshStoredSession();
        const latestToken = session?.accessToken ?? readAccessToken();
        if (!latestToken) return;
        socket.auth = { token: latestToken };
        const response = await socket.timeout(10_000).emitWithAck("chat:authenticate", { token: latestToken }) as { ok?: boolean; error?: string };
        if (!response.ok) setError(response.error || phrase("聊天连接重新认证失败。", "Chat connection reauthentication failed."));
      })().catch(() => setError(phrase("聊天连接重新认证失败，请重新登录。", "Chat connection reauthentication failed. Sign in again.")));
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
  }, [phrase, refreshSocialData, userId]);

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
        if (active) setError(loadError instanceof Error ? loadError.message : phrase("聊天记录加载失败。", "Could not load chat history."));
      })
      .finally(() => {
        if (active) setIsMessagesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isDesktop, isMinimized, isMobileConversationOpen, isOpen, phrase, selectedId]);

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
      setError(loadError instanceof Error ? loadError.message : phrase("更早的消息加载失败。", "Could not load earlier messages."));
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

  function clearComposerForConversation(conversationId: number, sentBody: string, sentFiles: File[]) {
    setDrafts((current) => {
      if ((current[conversationId] ?? "").trim() !== sentBody) return current;
      const { [conversationId]: _removed, ...rest } = current;
      void _removed;
      return rest;
    });
    setPendingAttachmentsByConversation((current) => {
      const attachments = current[conversationId] ?? [];
      const sentFileSet = new Set(sentFiles);
      const remaining = attachments.filter((attachment) => !sentFileSet.has(attachment.file));
      attachments.filter((attachment) => sentFileSet.has(attachment.file)).forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      if (remaining.length) return { ...current, [conversationId]: remaining };
      const { [conversationId]: _removed, ...rest } = current;
      void _removed;
      return rest;
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
      setError(phrase("当前浏览器不支持语音录制。", "This browser does not support voice recording."));
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
        setError(phrase("语音录制失败，请重试。", "Voice recording failed. Try again."));
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
          setError(phrase("没有录到有效的语音内容。", "No valid voice content was recorded."));
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
      setError(recordError instanceof Error ? recordError.message : phrase("无法使用麦克风。", "Could not use the microphone."));
    }
  }

  function addFiles(files: File[]) {
    if (selectedGroupIsBanned) {
      setError(selectedGroupBanNotice);
      return;
    }
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
    if (selectedGroupIsBanned) {
      setError(selectedGroupBanNotice);
      return;
    }
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
      setError(phrase(`每条消息最多添加 ${MAX_ATTACHMENTS} 个图片或文件。`, `Each message can include up to ${MAX_ATTACHMENTS} images or files.`));
      return false;
    }
    if ([...existingFiles, ...files].reduce((total, file) => total + file.size, 0) > MAX_BATCH_SIZE) {
      setError(phrase("一条消息的附件总大小不能超过 50MB。", "Attachments in one message cannot exceed 50 MB in total."));
      return false;
    }
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = file.type.startsWith("image/");
      const isAudio = file.type.startsWith("audio/");
      const isVideo = file.type.startsWith("video/");
      if (BLOCKED_EXTENSIONS.has(extension)) {
        setError(phrase(`不允许发送可执行文件或脚本：${file.name}`, `Executable files or scripts cannot be sent: ${file.name}`));
        return false;
      }
      if (isImage && file.size > MAX_IMAGE_SIZE) {
        setError(phrase(`单张图片不能超过 8MB：${file.name}`, `Each image cannot exceed 8 MB: ${file.name}`));
        return false;
      }
      if (isAudio && file.size > MAX_AUDIO_SIZE) {
        setError(phrase(`单个音频不能超过 20MB：${file.name}`, `Each audio file cannot exceed 20 MB: ${file.name}`));
        return false;
      }
      if (isVideo && file.size > MAX_VIDEO_SIZE) {
        setError(phrase(`单个视频不能超过 50MB：${file.name}`, `Each video cannot exceed 50 MB: ${file.name}`));
        return false;
      }
      if (!isImage && !isAudio && !isVideo && file.size > MAX_FILE_SIZE) {
        setError(phrase(`单个普通文件不能超过 20MB：${file.name}`, `Each file cannot exceed 20 MB: ${file.name}`));
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
    if (sendInFlightRef.current) return;
    if (selectedGroupIsBanned) {
      setError(selectedGroupBanNotice);
      return;
    }
    if (!socket?.connected) {
      setError(phrase("聊天连接尚未建立，请稍后重试。", "Chat connection is not ready. Try again shortly."));
      return;
    }
    sendInFlightRef.current = true;
    setIsSending(true);
    setError("");
    try {
      const attachments = files.length
        ? await uploadChatAttachments(token, conversationId, files)
        : [];
      const response = await socket.timeout(10000).emitWithAck("chat:send", {
        conversationId,
        body,
        attachmentIds: attachments.map((item) => item.id),
      }) as ChatAck;
      if (!response.ok) throw new Error(response.error || phrase("消息发送失败。", "Could not send message."));
      if (clearComposer) {
        clearComposerForConversation(conversationId, body, files);
        setIsEmojiOpen(false);
        setIsMobileToolsOpen(false);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : phrase("消息发送失败，请重试。", "Could not send message. Try again."));
    } finally {
      sendInFlightRef.current = false;
      setIsSending(false);
    }
  }

  async function sendQuickMessage(body: string) {
    const socket = socketRef.current;
    if (!selected || !socket?.connected || isSending) return;
    if (selectedGroupIsBanned) {
      setError(selectedGroupBanNotice);
      return;
    }
    setIsSending(true);
    try {
      const response = await socket.timeout(10000).emitWithAck("chat:send", {
        conversationId: selected.id,
        body,
        attachmentIds: [],
      }) as ChatAck;
      if (!response.ok) throw new Error(response.error || phrase("消息发送失败。", "Could not send message."));
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : phrase("消息发送失败，请重试。", "Could not send message. Try again."));
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
      setError(actionError instanceof Error ? actionError.message : phrase("会话创建失败。", "Could not create conversation."));
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
      setError(actionError instanceof Error ? actionError.message : phrase("会话创建失败。", "Could not create conversation."));
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
      setIsAddFriendOpen(false);
      await refreshSocialData();
      setNotice(phrase("好友申请已发送。", "Friend request sent."));
      notifySocialStateChange();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : phrase("好友申请发送失败。", "Could not send friend request."));
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
      if (!response.ok) throw new Error(response.error || phrase("聊天操作失败。", "Chat action failed."));
      const completedAction = pendingConversationAction;
      setPendingConversationAction(null);
      setMessages([]);
      if (completedAction === "delete") {
        setConversations((current) => current.filter((item) => item.id !== selected.id));
        setSelectedId(0);
        setIsMobileConversationOpen(false);
      }
      await refreshSocialData();
      setNotice(completedAction === "clear" ? phrase("聊天记录已清空。", "Chat history cleared.") : phrase("聊天已从当前列表删除，可通过好友搜索重新发起。", "Chat removed from this list. Start a new one through friend search."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("聊天操作失败。", "Chat action failed."));
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
      setNotice(muted ? phrase("已开启消息免打扰。", "Message notifications muted.") : phrase("已关闭消息免打扰。", "Message notifications unmuted."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("免打扰设置失败。", "Could not update mute settings."));
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
      setNotice(pushEnabled ? phrase(`${channelLabel}已接收推送。`, `${channelLabel} notifications enabled.`) : phrase(`${channelLabel}已暂停推送。`, `${channelLabel} notifications paused.`));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("频道推送设置失败。", "Could not update channel notifications."));
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
      setNotice(state.subscribed ? phrase("当前设备已开启浏览器推送。", "Browser push enabled on this device.") : phrase("当前设备已关闭浏览器推送。", "Browser push disabled on this device."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("浏览器推送设置失败。", "Could not update browser push settings."));
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
        Promise.all(notificationChannels.map((config) =>
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
      setNotice(phrase("消息设置已恢复默认。", "Message settings restored to default."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("消息设置恢复失败。", "Could not restore message settings."));
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
      setNotice(phrase("消息文字已复制。", "Message copied."));
    } catch {
      setError(phrase("复制失败，请检查浏览器的剪贴板权限。", "Could not copy. Check this browser's clipboard permission."));
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
      if (!response.ok) throw new Error(response.error || phrase("消息转发失败。", "Could not forward messages."));
      const forwardedCount = response.messages?.length ?? pendingMessageForward.messageIds.length;
      setPendingMessageForward(null);
      cancelMessageSelection();
      setNotice(phrase(`已向 ${friendship.user.nickname} 转发 ${forwardedCount} 条消息。`, `${forwardedCount} message(s) forwarded to ${friendship.user.nickname}.`));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("消息转发失败。", "Could not forward messages."));
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
      if (!response.ok) throw new Error(response.error || phrase("消息操作失败。", "Message action failed."));
      setMessages((current) => current.filter((message) => !messageIds.includes(message.id)));
      const completedOperation = operation;
      setPendingMessageOperation(null);
      cancelMessageSelection();
      await refreshSocialData();
      setNotice(
        completedOperation === "recall"
          ? phrase("消息已撤回。", "Message recalled.")
          : completedOperation === "delete-everyone"
            ? phrase("消息已双向物理删除。", "Message permanently deleted for everyone.")
            : phrase("消息已从当前账号删除。", "Message deleted from this account."),
      );
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("消息操作失败。", "Message action failed."));
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
      setError(phrase("聊天连接尚未建立，暂时无法发起通话。", "Chat connection is not ready, so a call cannot start yet."));
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
      router.push(localizedPath(notification.actionUrl, locale));
      setIsMinimized(true);
      return;
    }
    if (notification.context?.kind === "article_report") {
      const reportUrl = notification.context.status === "pending" && notification.context.reportId
        ? `/admin/articles?tab=articles&report=${notification.context.reportId}&reportSource=article`
        : notification.context.article?.slug
          ? `/articles/${notification.context.article.slug}`
          : notification.actionUrl;
      if (reportUrl) {
        router.push(localizedPath(reportUrl, locale));
        setIsMinimized(true);
        return;
      }
    }
    if (notification.context?.kind === "comment_report") {
      const reportUrl = notification.context.status === "pending" && notification.context.reportId
        ? `/admin/articles?tab=comments&report=${notification.context.reportId}&reportSource=comment`
        : notification.context.article?.slug
        ? `/articles/${notification.context.article.slug}${notification.context.commentId ? `?commentId=${notification.context.commentId}` : ""}`
        : notification.actionUrl;
      if (reportUrl) {
        router.push(localizedPath(reportUrl, locale));
        setIsMinimized(true);
        return;
      }
    }
    if (notification.type === "friend_request_received") {
      setSelectedId(notificationConversationId("system"));
      setSelectedSystemNotificationId(notification.id);
      setIsMobileConversationOpen(true);
      return;
    }
    if (notification.context?.kind === "stranger_message_request") {
      setSelectedId(notificationConversationId(notification.channel));
      setSelectedSystemNotificationId(notification.id);
      setIsMobileConversationOpen(true);
      return;
    }
    if (notification.context?.kind === "group_ban") {
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
    if (notification.channel !== "system" && notification.actionUrl) router.push(localizedPath(notification.actionUrl, locale));
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
      setNotice(completedAction === "block" ? phrase("已拉黑该用户。", "User blocked.") : phrase("已删除好友。", "Friend removed."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("好友关系操作失败。", "Friendship action failed."));
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
      setNotice(phrase("已解除拉黑，可以重新发送好友申请。", "User unblocked. You can send a friend request again."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("解除拉黑失败。", "Could not unblock user."));
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
      setNotice(result.count ? phrase(`已将 ${result.count} 条通知标为已读。`, `${result.count} notification(s) marked as read.`) : phrase("所选通知均已是已读状态。", "All selected notifications were already read."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("通知状态更新失败。", "Could not update notification status."));
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
      setNotice(phrase(`${target.channelLabel}已从消息列表删除，新通知到达后会重新显示。`, `${target.channelLabel} removed from the message list. It returns when a new notification arrives.`));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("通知频道删除失败。", "Could not remove notification channel."));
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
      setNotice(target.channel ? phrase(`${target.channelLabel}已清空。`, `${target.channelLabel} cleared.`) : phrase(`已删除 ${result.count} 条通知。`, `${result.count} notification(s) deleted.`));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("通知删除失败。", "Could not delete notifications."));
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
      } else if (context.kind === "stranger_message_request" && context.requestId) {
        const result = await respondStrangerMessageRequest(token, context.requestId, action === "accept" ? "accepted" : "declined");
        if (result.conversation) {
          setConversations((current) => [result.conversation!, ...current.filter((item) => item.id !== result.conversation!.id)]);
        }
      } else if (context.kind === "group_invitation" && context.groupId) {
        await respondChatGroupInvitationByGroup(token, context.groupId, action === "accept" ? "accepted" : "declined");
      } else if (context.kind === "group_join_request" && context.groupId && context.joinRequestId) {
        await respondChatGroupJoinRequest(token, context.groupId, context.joinRequestId, action === "accept" ? "approved" : "rejected");
      } else if (context.kind === "group_report" && context.reportId) {
        await handleChatGroupReport(token, context.reportId, action === "resolve-report"
          ? { status: "resolved", deleteMessage: true, resolution: phrase("群管理员已删除被举报消息", "A group administrator deleted the reported message") }
          : { status: "rejected", resolution: phrase("未发现违规", "No violation found") });
      } else {
        setGroupManagerInitialId(context.groupId ?? null);
        setGroupManagerInitialView(context.kind === "group_join_request" ? "invites" : "mine");
        setIsGroupManagerOpen(true);
        return;
      }
      await deleteNotification(token, notification.id);
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
      await refreshSocialData();
      setNotice(action === "accept" ? phrase("已同意。", "Accepted.") : action === "reject" ? phrase("已拒绝。", "Declined.") : action === "resolve-report" ? phrase("举报已处理。", "Report resolved.") : phrase("举报已驳回。", "Report rejected."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("群审批处理失败。", "Could not process group approval."));
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
      setNotice(phrase("举报已提交，群管理员可以在群资料中处理。", "Report submitted. Group administrators can handle it from group details."));
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : phrase("举报提交失败。", "Could not submit report."));
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

  const openNotificationChannel = notificationChannels.find((item) => item.id === openNotificationChannelMenuId) ?? null;
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
      <button aria-label={phrase("展开聊天窗", "Expand chat window")} className="chat-dock-minimized" onClick={expandFromIcon} onPointerDown={beginIconDrag} style={minimizedStyle} title={phrase("拖动调整位置，点击展开聊天", "Drag to reposition, click to expand chat")} type="button">
        <MessageCircleMore aria-hidden="true" size={23} />
        {dockUnreadCount ? <b>{formatCount(dockUnreadCount)}</b> : null}
      </button>
      {callPanel}
      <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </>;
  }

  return (
    <>
      <section className={`chat-dock${isMobileConversationOpen ? " mobile-conversation-open" : ""}`} aria-label={phrase("消息与聊天", "Messages and chat")} ref={dockRef} style={dockStyle}>
        <header className="chat-dock-titlebar" onPointerDown={beginDockDrag}>
          {!isDesktop && isMobileConversationOpen ? <button
              aria-label={phrase("返回消息列表", "Back to messages")}
              className="chat-mobile-back"
              onClick={() => setIsMobileConversationOpen(false)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={19} />
            </button> : null}
          <span><MessageCircleMore aria-hidden="true" size={18} /><strong>{selectedNotificationConfig?.label ?? selected?.group?.name ?? selected?.user.nickname ?? phrase("消息", "Messages")}</strong></span>
          <div>
            {isDesktop || !isMobileConversationOpen ? <button aria-label={phrase("添加好友", "Add friend")} onClick={() => { setIsAddFriendOpen(true); setUserSearch(""); setUserSearchResults([]); }} title={phrase("添加好友", "Add friend")} type="button"><UserPlus aria-hidden="true" size={17} /></button> : null}
            {isDesktop || !isMobileConversationOpen ? <button aria-label={phrase("群聊", "Groups")} onClick={() => { setGroupManagerInitialId(null); setGroupManagerInitialView("mine"); setIsGroupManagerOpen(true); }} title={phrase("群聊", "Groups")} type="button"><Users aria-hidden="true" size={17} /></button> : null}
            {isDesktop || !isMobileConversationOpen ? <button aria-expanded={isMessageSettingsOpen} aria-label={phrase("消息设置", "Message settings")} onClick={() => setIsMessageSettingsOpen((current) => !current)} title={phrase("消息设置", "Message settings")} type="button"><Settings2 aria-hidden="true" size={17} /></button> : null}
            {selected?.group && !isDesktop && isMobileConversationOpen ? <button aria-label={phrase("群资料", "Group details")} onClick={() => { setGroupManagerInitialId(selected.group!.id); setGroupManagerInitialView("mine"); setIsGroupManagerOpen(true); }} title={phrase("群资料", "Group details")} type="button"><Users aria-hidden="true" size={17} /></button> : null}
            {selected?.kind === "direct" && selected.canCall && (isDesktop || isMobileConversationOpen) ? <>
              <button aria-label={phrase("发起语音通话", "Start voice call")} disabled={isVoiceRecording || chatCalls.isPreparing || Boolean(chatCalls.state)} onClick={() => void chatCalls.startCall("voice")} title={phrase("语音通话", "Voice call")} type="button"><Phone aria-hidden="true" size={17} /></button>
              <button aria-label={phrase("发起视频通话", "Start video call")} disabled={isVoiceRecording || chatCalls.isPreparing || Boolean(chatCalls.state)} onClick={() => void chatCalls.startCall("video")} title={phrase("视频通话", "Video call")} type="button"><Video aria-hidden="true" size={17} /></button>
            </> : null}
            <button aria-label={phrase("最小化聊天窗", "Minimize chat window")} onClick={() => { setIsMessageSettingsOpen(false); setIsMinimized(true); }} title={phrase("最小化", "Minimize")} type="button"><Minus aria-hidden="true" size={17} /></button>
            <button aria-label={phrase("关闭聊天窗", "Close chat window")} onClick={closeDock} title={t("common.close")} type="button"><X aria-hidden="true" size={17} /></button>
          </div>
        </header>
        {isMessageSettingsOpen ? <section className="chat-message-settings" onPointerDown={(event) => event.stopPropagation()}>
          <header>
            <span><Settings2 aria-hidden="true" size={17} /><strong>{phrase("消息设置", "Message settings")}</strong></span>
            <button aria-label={phrase("关闭消息设置", "Close message settings")} onClick={() => setIsMessageSettingsOpen(false)} title={t("common.close")} type="button"><X aria-hidden="true" size={16} /></button>
          </header>
          <div className="chat-message-settings-section browser-push-section">
            <span className="chat-message-settings-label">{phrase("当前设备", "This device")}</span>
            <button
              aria-pressed={browserPushState?.subscribed ?? false}
              className="chat-message-setting-row"
              disabled={Boolean(messageSettingsBusyKey) || browserPushState?.supported === false || browserPushState?.enabled === false}
              onClick={() => void toggleBrowserPush()}
              type="button"
            >
              <span><strong>{phrase("浏览器推送", "Browser push")}</strong><small>{browserPushDescription(browserPushState, locale)}</small></span>
              <i className={browserPushState?.subscribed ? "active" : ""}>{messageSettingsBusyKey.startsWith("browser:") ? <LoaderCircle aria-hidden="true" className="spin" size={13} /> : null}</i>
            </button>
          </div>
          <div className="chat-message-settings-section">
            <span className="chat-message-settings-label">{phrase("通知频道", "Notification channels")}</span>
            {notificationChannels.map((config) => {
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
                <span><strong>{config.label}</strong><small>{pushEnabled ? phrase("接收站内提醒和设备推送", "Receive site and device notifications") : phrase("已暂停该频道提醒", "Notifications are paused for this channel")}</small></span>
                <i className={pushEnabled ? "active" : ""}>{busy ? <LoaderCircle aria-hidden="true" className="spin" size={13} /> : null}</i>
              </button>;
            })}
          </div>
          <div className="chat-message-settings-section">
            <span className="chat-message-settings-label">{phrase("免打扰会话", "Muted conversations")}</span>
            {mutedConversations.map((conversation) => <button
              className="chat-message-setting-row conversation"
              disabled={Boolean(messageSettingsBusyKey)}
              key={conversation.id}
              onClick={() => void toggleConversationMute(conversation, false)}
              type="button"
            >
              <ConversationAvatar conversation={conversation} />
              <span><strong>{conversation.group?.name ?? conversation.user.nickname}</strong><small>{phrase("点击恢复消息提醒", "Click to restore notifications")}</small></span>
              {messageSettingsBusyKey === `conversation:${conversation.id}`
                ? <LoaderCircle aria-hidden="true" className="spin" size={14} />
                : <Bell aria-hidden="true" size={14} />}
            </button>)}
            {!mutedConversations.length ? <span className="chat-message-settings-empty">{phrase("当前没有免打扰会话。", "There are no muted conversations.")}</span> : null}
          </div>
          <footer>
            <button disabled={Boolean(messageSettingsBusyKey)} onClick={() => void resetMessagePreferences()} type="button">
              {messageSettingsBusyKey === "reset" ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : <RotateCcw aria-hidden="true" size={14} />}
              {phrase("恢复默认", "Restore defaults")}
            </button>
          </footer>
        </section> : null}
        <div className={`chat-dock-body${isMobileConversationOpen ? " mobile-conversation-open" : ""}`}>
          <aside className="chat-dock-sidebar">
            <div className="chat-dock-sidebar-content">
              <label className="chat-friend-search">
                <Search aria-hidden="true" size={15} />
                <input aria-label={phrase("搜索当前好友或群聊", "Search friends or groups")} onChange={(event) => setFriendSearch(event.target.value)} placeholder={phrase("搜索好友或群聊", "Search friends or groups")} value={friendSearch} />
                {friendSearch ? <button aria-label={phrase("清空好友搜索", "Clear friend search")} onClick={() => setFriendSearch("")} title={t("common.clear")} type="button"><X aria-hidden="true" size={13} /></button> : null}
              </label>
              {isLoading ? <span className="chat-state">{t("common.loading")}</span> : null}
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
                      <button aria-expanded={openNotificationChannelMenuId === entry.id} aria-label={phrase(`${entry.config.label}管理`, `Manage ${entry.config.label}`)} onClick={(event) => { event.stopPropagation(); setOpenNotificationChannelMenuId((current) => current === entry.id ? 0 : entry.id); }} title={phrase("频道管理", "Manage channel")} type="button"><MoreHorizontal aria-hidden="true" size={16} /></button>
                      {isDesktop && openNotificationChannelMenuId === entry.id ? <span className="chat-notification-channel-menu">
                        <button className="danger" onClick={() => requestNotificationChannelHide(entry.config.channel, entry.id, entry.config.label)} type="button"><Trash2 aria-hidden="true" size={14} />{phrase("删除频道通知", "Remove channel notifications")}</button>
                        {items.length ? <button className="danger" onClick={() => requestNotificationChannelClear(entry.config.channel, entry.config.label)} type="button"><Eraser aria-hidden="true" size={14} />{phrase("清空当前频道", "Clear current channel")}</button> : null}
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
                  onViewProfile={() => { setOpenFriendActionId(0); router.push(localizedPath(`/users/${encodeURIComponent(entry.conversation.user.username)}`, locale)); }}
                  onToggleMenu={(friendshipId) => setOpenFriendActionId((current) => current === friendshipId ? 0 : friendshipId)}
                  preview={getConversationPreview(entry.conversation, locale)}
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
                    onViewProfile={() => { setOpenFriendActionId(0); router.push(localizedPath(`/users/${encodeURIComponent(friendship.user.username)}`, locale)); }}
                    onToggleMenu={(friendshipId) => setOpenFriendActionId((current) => current === friendshipId ? 0 : friendshipId)}
                    preview={phrase("开始聊天", "Start chatting")}
                    muted={false}
                    unreadCount={0}
                    user={friendship.user}
                  />
                ))}

                {friendships.blocked.length ? <details className="chat-blocked-list">
                  <summary><Ban aria-hidden="true" size={14} />{phrase("黑名单", "Blocked users")} <b>{friendships.blocked.length}</b></summary>
                  {friendships.blocked.map((friendship) => <div className="chat-blocked-row" key={friendship.id}><UserAvatar user={friendship.user} /><span><strong>{friendship.user.nickname}</strong><small>@{friendship.user.username}</small></span><button onClick={() => void handleUnblock(friendship)} title={phrase("解除拉黑", "Unblock")} type="button"><ShieldOff aria-hidden="true" size={15} /></button></div>)}
                </details> : null}

                {!isLoading && normalizedFriendSearch && !primaryEntries.length && !filteredFriendsWithoutConversation.length ? <span className="chat-sidebar-empty">{phrase("没有找到匹配的好友。", "No matching friends found.")}</span> : null}
                {!isLoading && !normalizedFriendSearch && !primaryEntries.length && !friendships.friends.length ? <span className="chat-sidebar-empty">{phrase("还没有好友或会话。", "No friends or conversations yet.")}</span> : null}
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
              onOpenArticle={(slug) => router.push(localizedPath(`/articles/${slug}`, locale))}
              onOpenGroup={(groupId) => { setGroupManagerInitialId(groupId); setGroupManagerInitialView("mine"); setIsGroupManagerOpen(true); }}
              onOpenProfile={(username) => router.push(localizedPath(`/users/${encodeURIComponent(username)}`, locale))}
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
                {isOlderMessagesLoading ? <span className="chat-load-older"><LoaderCircle aria-hidden="true" className="spin" size={14} />{phrase("正在读取更早消息", "Loading earlier messages")}</span> : null}
                {isMessagesLoading ? <span className="chat-state">{phrase("正在读取聊天记录。", "Loading chat history.")}</span> : messages.map((message) => (
                  <ChatMessageItem
                    key={message.id}
                    message={message}
                    mine={message.sender.id === user.id}
                    onCall={() => callFromMessage(message)}
                    onGreeting={() => void sendQuickMessage(phrase("你好", "Hello"))}
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
              {selectedGroupIsBanned ? <div className="chat-group-ban-notice"><Ban aria-hidden="true" size={16} /><span><strong>{phrase("该群已被站点封禁", "This group is banned by the site")}</strong><small>{selectedGroupBanNotice}{selected?.group?.banReason ? ` ${phrase("原因：", "Reason: ")}${selected.group.banReason}` : ""}</small></span></div> : null}
              {isMessageSelectionMode ? <div className="chat-message-selection-bar">
                <button onClick={cancelMessageSelection} type="button">{t("common.cancel")}</button>
                <strong>{phrase(`已选择 ${selectedMessageIds.size} 条`, `${selectedMessageIds.size} selected`)}</strong>
                <button disabled={!selectedMessagesCanForward || isMessageActionRunning} onClick={() => openMessageForward(Array.from(selectedMessageIds))} title={selectedMessagesCanForward ? phrase("逐条转发所选消息", "Forward selected messages one by one") : phrase("系统消息不能转发", "System messages cannot be forwarded")} type="button"><Forward aria-hidden="true" size={15} />{phrase("转发", "Forward")}</button>
                <button disabled={!selectedMessageIds.size || isMessageActionRunning} onClick={() => requestSelectedMessageDeletion("self")} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("删除", "Delete")}</button>
                <button className="danger" disabled={!selectedMessageIds.size || isMessageActionRunning} onClick={() => requestSelectedMessageDeletion("everyone")} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("双向删除", "Delete for everyone")}</button>
              </div> : <form className={`chat-composer${selectedGroupIsBanned ? " disabled" : ""}`} onDragOver={(event) => { if (!selectedGroupIsBanned) event.preventDefault(); }} onDrop={handleDrop} onSubmit={sendMessage}>
                {pendingAttachments.length ? <div className="chat-pending-attachments">{pendingAttachments.map((attachment) => (
                  <span key={attachment.id}>{attachment.kind === "image" && attachment.previewUrl
                    ? <img alt="" src={attachment.previewUrl} />
                    : attachment.kind === "audio"
                      ? <FileAudio aria-hidden="true" size={24} />
                      : attachment.kind === "video"
                        ? <FileVideo aria-hidden="true" size={24} />
                        : <FileText aria-hidden="true" size={22} />}<small title={attachment.file.name}>{attachment.file.name}</small><button aria-label={phrase(`移除 ${attachment.file.name}`, `Remove ${attachment.file.name}`)} onClick={() => removePendingAttachment(attachment.id)} type="button"><X aria-hidden="true" size={13} /></button></span>
                ))}</div> : null}
                <div className="chat-composer-row">
                  <input accept=".jpg,.jpeg,.png,.webp,.webm,.m4a,.mp3,.wav,.ogg,.mp4,.mov,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.json,.xml,.rtf,.zip,.rar,.7z,.gz,.tar" hidden multiple onChange={(event) => { handleSelectedFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} ref={fileInputRef} type="file" />
                  <div className="chat-composer-tools">
                    {!isDesktop ? <button aria-label={phrase("更多聊天功能", "More chat actions")} className={`chat-mobile-more${isMobileToolsOpen ? " active" : ""}`} disabled={selectedGroupIsBanned} onClick={() => { setIsMobileToolsOpen((current) => !current); setIsEmojiOpen(false); }} title={phrase("更多", "More")} type="button"><Plus aria-hidden="true" size={19} /></button> : null}
                    <button aria-label={phrase("添加表情", "Add emoji")} className={`chat-desktop-tool${isEmojiOpen ? " active" : ""}`} disabled={selectedGroupIsBanned} onClick={() => { setIsEmojiOpen((current) => !current); setIsMobileToolsOpen(false); }} title={phrase("表情", "Emoji")} type="button"><Laugh aria-hidden="true" size={18} /></button>
                    <button aria-label={phrase("添加图片或文件", "Add images or files")} className="chat-desktop-tool" disabled={selectedGroupIsBanned} onClick={() => fileInputRef.current?.click()} title={phrase("添加图片或文件", "Add images or files")} type="button"><Paperclip aria-hidden="true" size={18} /></button>
                  </div>
                  <textarea aria-label={phrase(`给 ${selected.group?.name ?? selected.user.nickname} 发消息`, `Message ${selected.group?.name ?? selected.user.nickname}`)} disabled={selectedGroupIsBanned} maxLength={2000} onChange={(event) => updateDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} onPaste={handlePaste} placeholder={selectedGroupIsBanned ? phrase("该群已被封禁，暂时无法发送消息", "This group is banned and cannot receive messages") : phrase("输入消息", "Write a message")} rows={2} value={draft} />
                  <button
                    aria-label={isVoiceRecording ? phrase(`松开发送语音，已录制 ${formatDuration(voiceRecordingSeconds)}`, `Release to send voice message, recorded ${formatDuration(voiceRecordingSeconds)}`) : phrase("发送消息，长按录制语音", "Send message. Hold to record voice.")}
                    className={isVoiceRecording ? "recording" : undefined}
                    disabled={selectedGroupIsBanned || isSending || Boolean(chatCalls.state)}
                    onClick={(event) => { if (suppressSendClickRef.current || (!draft.trim() && !pendingAttachments.length)) event.preventDefault(); suppressSendClickRef.current = false; }}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerCancel={handleSendPointerCancel}
                    onPointerDown={handleSendPointerDown}
                    onPointerUp={handleSendPointerUp}
                    title={isVoiceRecording ? phrase(`松开发送 ${formatDuration(voiceRecordingSeconds)}`, `Release to send ${formatDuration(voiceRecordingSeconds)}`) : phrase("发送，长按录音", "Send. Hold to record.")}
                    type="submit"
                  >{isSending ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : isVoiceRecording ? <Square aria-hidden="true" size={15} /> : <Send aria-hidden="true" size={18} />}</button>
                </div>
                {isMobileToolsOpen && !selectedGroupIsBanned ? <div className="chat-mobile-tools-panel">
                  <button onClick={() => { setIsMobileToolsOpen(false); setIsEmojiOpen(true); }} type="button"><span><Laugh aria-hidden="true" size={22} /></span><small>{phrase("表情", "Emoji")}</small></button>
                  <button onClick={() => { setIsMobileToolsOpen(false); fileInputRef.current?.click(); }} type="button"><span><ImageIcon aria-hidden="true" size={22} /></span><small>{phrase("图片与文件", "Images and files")}</small></button>
                </div> : null}
                {isEmojiOpen ? <div className="chat-emoji-picker">{EMOJIS.map((emoji) => <button key={emoji} onClick={() => { updateDraft(`${draft}${emoji}`); setIsEmojiOpen(false); }} type="button">{emoji}</button>)}</div> : null}
              </form>}
            </> : <div className="chat-empty"><MessageCircle aria-hidden="true" size={28} /><strong>{phrase("选择一位好友开始聊天", "Choose a friend to start chatting")}</strong><span>{phrase("可以发送文字、表情、图片和文件。", "You can send text, emoji, images, and files.")}</span></div>}
          </main>
        </div>
        {actionMessage && !isMessageSelectionMode ? <span className={`chat-message-action-menu${messageActionPosition ? " context-positioned" : ""}`} data-chat-message-action style={messageActionStyle}>
          <button onClick={() => beginMessageSelection(actionMessage.id)} type="button"><Check aria-hidden="true" size={14} />{phrase("选择", "Select")}</button>
          {actionMessage.body ? <button onClick={() => void copyMessageBody(actionMessage)} type="button"><Copy aria-hidden="true" size={14} />{phrase("复制", "Copy")}</button> : null}
          {actionMessage.type !== "system" && !selectedGroupIsBanned ? <button onClick={() => openMessageForward([actionMessage.id])} type="button"><Forward aria-hidden="true" size={14} />{phrase("转发", "Forward")}</button> : null}
          {selected?.group && actionMessage.sender.id !== user.id && actionMessage.type !== "system" ? <button onClick={() => { setPendingGroupReportMessageId(actionMessage.id); setOpenMessageActionId(0); setGroupReportReason("spam"); setGroupReportDetail(""); }} type="button"><Flag aria-hidden="true" size={14} />{phrase("举报", "Report")}</button> : null}
          {actionMessage.sender.id === user.id && actionMessage.type !== "system" && messageActionOpenedAt - timestamp(actionMessage.createdAt) <= 2 * 60 * 1000
            ? <button onClick={() => requestMessageOperation("recall", actionMessage.id)} type="button"><Undo2 aria-hidden="true" size={14} />{phrase("撤回消息", "Recall message")}</button>
            : null}
          <button onClick={() => requestMessageOperation("delete-self", actionMessage.id)} type="button"><Trash2 aria-hidden="true" size={14} />{phrase("删除", "Delete")}</button>
          <button className="danger" onClick={() => requestMessageOperation("delete-everyone", actionMessage.id)} type="button"><Trash2 aria-hidden="true" size={14} />{phrase("双向删除", "Delete for everyone")}</button>
        </span> : null}
        {actionNotification && !isNotificationSelectionMode ? <span className={`chat-notification-action-menu${notificationActionPosition ? " context-positioned" : ""}`} data-chat-notification-action style={notificationActionStyle}>
          <button onClick={() => beginNotificationSelection(actionNotification.id)} type="button"><Check aria-hidden="true" size={14} />{phrase("选择", "Select")}</button>
          {!actionNotification.readAt ? <button onClick={() => void markNotificationSelectionRead([actionNotification.id])} type="button"><Bell aria-hidden="true" size={14} />{phrase("标为已读", "Mark as read")}</button> : null}
          <button className="danger" onClick={() => requestNotificationDeletion([actionNotification.id])} type="button"><Trash2 aria-hidden="true" size={14} />{phrase("删除通知", "Delete notification")}</button>
        </span> : null}
        {pendingGroupReportMessageId ? <div className="chat-confirm-backdrop" onClick={() => { if (!isMessageActionRunning) setPendingGroupReportMessageId(0); }} role="presentation"><div aria-modal="true" className="chat-add-friend-dialog chat-group-report-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><header><span><Flag aria-hidden="true" size={18} /><strong>{phrase("举报群消息", "Report group message")}</strong></span><button aria-label={phrase("关闭举报窗口", "Close report dialog")} onClick={() => setPendingGroupReportMessageId(0)} title={t("common.close")} type="button"><X aria-hidden="true" size={17} /></button></header><div className="chat-group-report-form"><label><span>{phrase("举报原因", "Report reason")}</span><GlassSelect ariaLabel={phrase("举报原因", "Report reason")} onChange={setGroupReportReason} options={groupReportReasonOptions} value={groupReportReason} /></label><label><span>{phrase("补充说明", "Additional details")}</span><textarea maxLength={300} onChange={(event) => setGroupReportDetail(event.target.value)} placeholder={phrase("可选，帮助管理员更快判断", "Optional, helps administrators decide faster")} rows={3} value={groupReportDetail} /></label><footer><button disabled={isMessageActionRunning} onClick={() => setPendingGroupReportMessageId(0)} type="button">{t("common.cancel")}</button><button disabled={isMessageActionRunning} onClick={() => void submitGroupReport()} type="button">{isMessageActionRunning ? phrase("提交中", "Submitting") : phrase("提交举报", "Submit report")}</button></footer></div></div></div> : null}
        {pendingMessageForward ? <div className="chat-confirm-backdrop" onClick={() => { if (!isForwardingMessages) setPendingMessageForward(null); }} role="presentation">
          <div aria-modal="true" className="chat-add-friend-dialog chat-forward-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <header><span><Forward aria-hidden="true" size={18} /><strong>{phrase("选择转发对象", "Choose forwarding target")}</strong></span><button aria-label={phrase("关闭转发窗口", "Close forwarding dialog")} disabled={isForwardingMessages} onClick={() => setPendingMessageForward(null)} title={t("common.close")} type="button"><X aria-hidden="true" size={17} /></button></header>
            <label className="chat-user-search"><Search aria-hidden="true" size={16} /><input autoFocus maxLength={40} onChange={(event) => setForwardTargetSearch(event.target.value)} placeholder={phrase("搜索好友", "Search friends")} value={forwardTargetSearch} />{forwardTargetSearch ? <button aria-label={phrase("清空好友搜索", "Clear friend search")} onClick={() => setForwardTargetSearch("")} type="button"><X aria-hidden="true" size={13} /></button> : null}</label>
            <div className="chat-forward-target-list">
              {forwardTargets.map((friendship) => <button disabled={isForwardingMessages} key={friendship.id} onClick={() => void forwardMessagesTo(friendship)} type="button"><UserAvatar user={friendship.user} /><span><strong>{friendship.user.nickname}<RoleSymbol code={friendship.user.role.code} /></strong><small>@{friendship.user.username}</small></span><Forward aria-hidden="true" size={15} /></button>)}
              {!forwardTargets.length ? <span className="chat-sidebar-empty">{phrase("没有可转发的好友。", "There are no friends available for forwarding.")}</span> : null}
            </div>
            <small className="chat-forward-hint">{phrase(`将按原顺序逐条转发 ${pendingMessageForward.messageIds.length} 条消息。`, `${pendingMessageForward.messageIds.length} messages will be forwarded in their original order.`)}</small>
          </div>
        </div> : null}
        {isAddFriendOpen && !friendRequestTarget ? <div className="chat-confirm-backdrop" onClick={() => { if (!isFriendRequestSending) { setIsAddFriendOpen(false); setFriendRequestTarget(null); } }} role="presentation">
          <div aria-modal="true" className="chat-add-friend-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <header><span><UserPlus aria-hidden="true" size={18} /><strong>{phrase("添加好友", "Add friend")}</strong></span><button aria-label={phrase("关闭添加好友", "Close add friend dialog")} onClick={() => { setIsAddFriendOpen(false); setFriendRequestTarget(null); }} title={t("common.close")} type="button"><X aria-hidden="true" size={17} /></button></header>
            <label className="chat-user-search"><Search aria-hidden="true" size={16} /><input autoFocus maxLength={40} onChange={(event) => setUserSearch(event.target.value)} placeholder={phrase("搜索昵称或用户名", "Search display name or username")} value={userSearch} />{userSearch ? <button aria-label={phrase("清空用户搜索", "Clear user search")} onClick={() => setUserSearch("")} type="button"><X aria-hidden="true" size={13} /></button> : null}</label>
            <div className="chat-user-search-results">
              {isUserSearching ? <span className="chat-state">{phrase("正在搜索。", "Searching.")}</span> : null}
              {!isUserSearching && userSearch.trim().length < 2 ? <span className="chat-sidebar-empty">{phrase("至少输入 2 个字符。", "Enter at least 2 characters.")}</span> : null}
              {!isUserSearching && userSearch.trim().length >= 2 && !userSearchResults.length ? <span className="chat-sidebar-empty">{phrase("没有找到匹配的用户。", "No matching users found.")}</span> : null}
              {userSearchResults.map((result) => <div className="chat-user-search-result" key={result.id}>
                <UserAvatar user={result} />
                <span><strong>{result.nickname}<RoleSymbol code={result.role.code} /></strong><small>@{result.username}</small></span>
                {result.relationship?.status === "accepted" ? <button onClick={() => void openSearchResultChat(result)} type="button">{phrase("发消息", "Message")}</button>
                  : result.canRequest ? <button onClick={() => { setFriendRequestTarget(result); setFriendRequestNote(""); }} type="button">{phrase("添加", "Add")}</button>
                    : <small className="chat-user-search-status">{result.relationship?.status === "pending"
                      ? result.relationship.direction === "incoming" ? phrase("对方已申请", "Request received") : phrase("等待确认", "Awaiting confirmation")
                      : result.relationship?.status === "blocked" ? phrase("暂不可添加", "Unavailable") : phrase("暂不可添加", "Unavailable")}</small>}
              </div>)}
            </div>
          </div>
        </div> : null}
        {friendRequestTarget ? <RequestComposerDialog icon={<UserPlus aria-hidden="true" size={18} />} isSubmitting={isFriendRequestSending} label={phrase("申请备注", "Request note")} maxLength={120} onChange={setFriendRequestNote} onClose={() => { setFriendRequestTarget(null); setFriendRequestNote(""); }} onSubmit={() => void sendFriendRequest()} placeholder={phrase("简单介绍一下自己，可不填", "Introduce yourself briefly (optional)")} submitLabel={phrase("发送好友申请", "Send friend request")} title={phrase("发送好友申请", "Send friend request")} value={friendRequestNote}><div className="chat-user-search-result identity"><UserAvatar large user={friendRequestTarget} /><span><strong>{friendRequestTarget.nickname}</strong><small>@{friendRequestTarget.username}</small></span><RoleSymbol code={friendRequestTarget.role.code} /></div></RequestComposerDialog> : null}
        {pendingFriendAction ? <div className="chat-confirm-backdrop" onClick={() => { if (!isFriendActionRunning) setPendingFriendAction(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon">{pendingFriendAction.action === "block" ? <Ban aria-hidden="true" size={20} /> : <UserMinus aria-hidden="true" size={20} />}</span><div><strong>{pendingFriendAction.action === "block" ? phrase(`拉黑 ${pendingFriendAction.friendship.user.nickname}`, `Block ${pendingFriendAction.friendship.user.nickname}`) : phrase(`删除好友 ${pendingFriendAction.friendship.user.nickname}`, `Remove ${pendingFriendAction.friendship.user.nickname}`)}</strong><p>{pendingFriendAction.action === "block" ? phrase("拉黑后双方不能查看或发送聊天消息。历史记录会保留，解除拉黑后仍需重新添加好友。", "After blocking, neither person can view or send chat messages. History remains, but becoming friends again is required after unblocking.") : phrase("删除后聊天记录会保留，但双方需要重新添加好友才能继续聊天。", "Chat history remains after removal, but both people must become friends again to continue chatting.")}</p></div><footer><button disabled={isFriendActionRunning} onClick={() => setPendingFriendAction(null)} type="button">{phrase("取消", "Cancel")}</button><button className="danger" disabled={isFriendActionRunning} onClick={() => void executeFriendAction()} type="button">{isFriendActionRunning ? phrase("处理中", "Processing") : pendingFriendAction.action === "block" ? phrase("确认拉黑", "Confirm block") : phrase("确认删除", "Confirm removal")}</button></footer></div></div> : null}
        {pendingConversationAction ? <div className="chat-confirm-backdrop" onClick={() => { if (!isConversationActionRunning) setPendingConversationAction(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon">{pendingConversationAction === "clear" ? <Eraser aria-hidden="true" size={20} /> : <Trash2 aria-hidden="true" size={20} />}</span><div><strong>{pendingConversationAction === "clear" ? phrase("清空当前聊天记录", "Clear current chat history") : phrase("从聊天列表删除会话", "Remove conversation from chat list")}</strong><p>{pendingConversationAction === "clear" ? phrase("当前账号中的系统消息、文字、图片和文件记录都会被清空，会话入口和好友关系保留。", "System messages, text, images, and files are cleared only from this account. The conversation and friendship remain.") : phrase("当前账号中的系统消息和全部聊天内容都会被清空，并从聊天列表移除；好友关系保留，可重新发起空会话。", "System messages and all chat content are cleared from this account and removed from the list. The friendship remains and you can start a new empty conversation.")}</p></div><footer><button disabled={isConversationActionRunning} onClick={() => setPendingConversationAction(null)} type="button">{phrase("取消", "Cancel")}</button><button className="danger" disabled={isConversationActionRunning} onClick={() => void executeConversationAction()} type="button">{isConversationActionRunning ? phrase("处理中", "Processing") : phrase("确认", "Confirm")}</button></footer></div></div> : null}
        {pendingMessageOperation ? <div className="chat-confirm-backdrop" onClick={() => { if (!isMessageActionRunning) setPendingMessageOperation(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon">{pendingMessageOperation.operation === "recall" ? <Undo2 aria-hidden="true" size={20} /> : <Trash2 aria-hidden="true" size={20} />}</span><div><strong>{pendingMessageOperation.operation === "recall" ? phrase("撤回这条消息", "Recall this message") : pendingMessageOperation.operation === "delete-everyone" ? phrase(`双向删除 ${pendingMessageOperation.messageIds.length} 条消息`, `Delete ${pendingMessageOperation.messageIds.length} message(s) for everyone`) : phrase(`删除 ${pendingMessageOperation.messageIds.length} 条消息`, `Delete ${pendingMessageOperation.messageIds.length} message(s)`)}</strong><p>{pendingMessageOperation.operation === "recall" ? phrase("原消息和附件会被物理删除，双方聊天中会保留一条撤回提示。", "The message and attachments are physically deleted, while both chats retain a recall notice.") : pendingMessageOperation.operation === "delete-everyone" ? phrase("消息会从双方记录中永久删除，关联附件也会从磁盘删除，操作无法恢复。", "Messages are permanently deleted from both records, and related attachments are removed from disk. This cannot be undone.") : phrase("这些消息只会从当前账号隐藏，对方仍然可以查看。", "These messages are hidden only from this account; the other person can still view them.")}</p></div><footer><button disabled={isMessageActionRunning} onClick={() => setPendingMessageOperation(null)} type="button">{phrase("取消", "Cancel")}</button><button className="danger" disabled={isMessageActionRunning} onClick={() => void executeMessageOperation()} type="button">{isMessageActionRunning ? phrase("处理中", "Processing") : phrase("确认", "Confirm")}</button></footer></div></div> : null}
        {pendingNotificationDeletion ? <div className="chat-confirm-backdrop" onClick={() => { if (!isNotificationActionRunning) setPendingNotificationDeletion(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon"><Trash2 aria-hidden="true" size={20} /></span><div><strong>{pendingNotificationDeletion.channel ? phrase(`清空${pendingNotificationDeletion.channelLabel}`, `Clear ${pendingNotificationDeletion.channelLabel}`) : phrase(`删除 ${pendingNotificationDeletion.notificationIds.length} 条通知`, `Delete ${pendingNotificationDeletion.notificationIds.length} notification(s)`)}</strong><p>{pendingNotificationDeletion.channel ? phrase("当前频道中显示的通知会从该账号永久删除，待处理好友申请不会受影响。", "Notifications shown in this channel are permanently deleted from this account. Pending friend requests are unaffected.") : phrase("所选通知会从当前账号永久删除，操作无法恢复。", "Selected notifications are permanently deleted from this account. This cannot be undone.")}</p></div><footer><button disabled={isNotificationActionRunning} onClick={() => setPendingNotificationDeletion(null)} type="button">{phrase("取消", "Cancel")}</button><button className="danger" disabled={isNotificationActionRunning} onClick={() => void executeNotificationDeletion()} type="button">{isNotificationActionRunning ? phrase("处理中", "Processing") : phrase("确认删除", "Confirm deletion")}</button></footer></div></div> : null}
        {pendingNotificationChannelHide ? <div className="chat-confirm-backdrop" onClick={() => { if (!isNotificationActionRunning) setPendingNotificationChannelHide(null); }} role="presentation"><div aria-modal="true" className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><span className="chat-confirm-icon"><Trash2 aria-hidden="true" size={20} /></span><div><strong>{phrase(`从消息列表删除${pendingNotificationChannelHide.channelLabel}`, `Remove ${pendingNotificationChannelHide.channelLabel} from message list`)}</strong><p>{phrase("频道会从当前账号的消息列表隐藏，已有通知不会删除；收到新的频道通知后会自动重新显示。", "The channel is hidden from this account's message list without deleting existing notifications. It reappears when a new notification arrives.")}</p></div><footer><button disabled={isNotificationActionRunning} onClick={() => setPendingNotificationChannelHide(null)} type="button">{phrase("取消", "Cancel")}</button><button className="danger" disabled={isNotificationActionRunning} onClick={() => void executeNotificationChannelHide()} type="button">{isNotificationActionRunning ? phrase("处理中", "Processing") : phrase("确认删除", "Confirm deletion")}</button></footer></div></div> : null}
        <button aria-label={phrase("调整聊天窗大小", "Resize chat window")} className="chat-dock-resize-handle" onPointerDown={beginDockResize} tabIndex={-1} type="button" />
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
          <button className="danger" onClick={() => requestNotificationChannelHide(openNotificationChannel.channel, openNotificationChannel.id, openNotificationChannel.label)} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("删除频道通知", "Remove channel notifications")}</button>
          {openNotificationChannelItems.length ? <button className="danger" onClick={() => requestNotificationChannelClear(openNotificationChannel.channel, openNotificationChannel.label)} type="button"><Eraser aria-hidden="true" size={15} />{phrase("清空当前频道", "Clear current channel")}</button> : null}
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
  const { phrase } = useLanguage();
  return <div className={`chat-sidebar-contact-row${active ? " active" : ""}`}>
    <button className="chat-sidebar-primary-row" onClick={onOpen} type="button">
      <UserAvatar user={user} />
      <span><strong className="chat-conversation-name">{user.nickname}<RoleSymbol code={user.role.code} />{muted ? <BellOff aria-hidden="true" className="chat-muted-inline" size={13} /> : null}</strong><small>{preview}</small></span>
      {unreadCount ? <b className={muted ? "muted" : undefined}>{muted ? "" : formatCount(unreadCount)}</b> : null}
    </button>
    {friendship || onConversationAction ? <div className="chat-friend-action" data-chat-friend-action>
      <button aria-expanded={menuOpen} aria-label={phrase(`${user.nickname} 的聊天管理`, `Manage chat with ${user.nickname}`)} className="chat-friend-action-trigger" onClick={(event) => { event.stopPropagation(); onToggleMenu(friendship?.id ?? -user.id); }} title={phrase("聊天管理", "Chat actions")} type="button"><MoreHorizontal aria-hidden="true" size={16} /></button>
      {menuOpen ? <div className="chat-friend-action-menu">
        {friendship ? <>
          <button onClick={onViewProfile} type="button"><UserRound aria-hidden="true" size={15} />{phrase("查看主页", "View profile")}</button>
          <button onClick={() => onAction(friendship, "remove")} type="button"><UserMinus aria-hidden="true" size={15} />{phrase("删除好友", "Remove friend")}</button>
          <button onClick={() => onAction(friendship, "block")} type="button"><Ban aria-hidden="true" size={15} />{phrase("拉黑好友", "Block friend")}</button>
        </> : null}
        {onConversationAction ? <>
          {friendship ? <span className="chat-friend-action-menu-divider" /> : null}
          {onToggleMute ? <button onClick={() => onToggleMute(!muted)} type="button">{muted ? <Bell aria-hidden="true" size={15} /> : <BellOff aria-hidden="true" size={15} />}{muted ? phrase("关闭免打扰", "Unmute notifications") : phrase("消息免打扰", "Mute notifications")}</button> : null}
          <button onClick={() => onConversationAction("clear")} type="button"><Eraser aria-hidden="true" size={15} />{phrase("清空聊天", "Clear chat")}</button>
          <button className="danger" onClick={() => onConversationAction("delete")} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("删除聊天", "Delete chat")}</button>
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
  const { locale, phrase } = useLanguage();
  const group = conversation.group!;
  return <div className={`chat-sidebar-contact-row chat-sidebar-group-row${active ? " active" : ""}`}>
    <button className="chat-sidebar-primary-row" onClick={onOpen} type="button">
      <ConversationAvatar conversation={conversation} />
      <span><strong className="chat-conversation-name"><Users aria-hidden="true" className="chat-group-inline-mark" size={13} />{group.name}{group.isBanned ? <Ban aria-hidden="true" className="chat-group-banned-inline" size={13} /> : null}{group.temporary ? <Clock3 aria-hidden="true" className="chat-muted-inline" size={13} /> : null}{conversation.muted ? <BellOff aria-hidden="true" className="chat-muted-inline" size={13} /> : null}</strong><small>{group.isBanned ? phrase("群聊已被站点封禁", "This group is banned by the site") : getConversationPreview(conversation, locale)}</small></span>
      <span className="chat-group-pending-badges">{group.pendingJoinRequestCount ? <b title={phrase("待处理入群申请", "Pending join requests")}><UserPlus aria-hidden="true" size={11} />{formatCount(group.pendingJoinRequestCount)}</b> : null}{group.pendingReportCount ? <b className="report" title={phrase("待处理举报", "Pending reports")}><Flag aria-hidden="true" size={11} />{formatCount(group.pendingReportCount)}</b> : null}{conversation.unreadCount ? <b className={conversation.muted ? "muted" : undefined}>{conversation.muted ? "" : formatCount(conversation.unreadCount)}</b> : null}</span>
    </button>
    <div className="chat-friend-action" data-chat-friend-action>
      <button aria-expanded={menuOpen} aria-label={phrase(`${group.name} 的群聊管理`, `Manage ${group.name}`)} className="chat-friend-action-trigger" onClick={(event) => { event.stopPropagation(); onToggleMenu(); }} title={phrase("群聊管理", "Group actions")} type="button"><MoreHorizontal aria-hidden="true" size={16} /></button>
      {menuOpen ? <div className="chat-friend-action-menu">
        <button onClick={onManage} type="button"><Users aria-hidden="true" size={15} />{phrase("群资料与成员", "Group details and members")}</button>
        <span className="chat-friend-action-menu-divider" />
        <button onClick={() => onToggleMute(!conversation.muted)} type="button">{conversation.muted ? <Bell aria-hidden="true" size={15} /> : <BellOff aria-hidden="true" size={15} />}{conversation.muted ? phrase("关闭免打扰", "Unmute notifications") : phrase("消息免打扰", "Mute notifications")}</button>
        <button onClick={() => onConversationAction("clear")} type="button"><Eraser aria-hidden="true" size={15} />{phrase("清空聊天", "Clear chat")}</button>
        <button className="danger" onClick={() => onConversationAction("delete")} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("删除聊天", "Delete chat")}</button>
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
  const { locale, phrase } = useLanguage();
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
          {isSelectionMode ? <button aria-label={selected ? phrase("取消选择通知", "Deselect notification") : phrase("选择通知", "Select notification")} aria-pressed={selected} className="chat-notification-selector" onClick={() => onToggleSelection(notification.id)} type="button">{selected ? <Check aria-hidden="true" size={13} /> : null}</button> : null}
          <div className="chat-system-notification-card">
            <NotificationIdentity notification={notification} onOpenGroup={onOpenGroup} onOpenProfile={onOpenProfile} />
            <div className="chat-system-notification-main">
              <button className="chat-system-notification-copy" onClick={() => void onSelect(notification)} type="button"><span>
                <span className="chat-notification-heading">
                  {notification.context?.kind === "announcement" ? <span className="chat-announcement-notification-type">{phrase("站点公告", "Site announcement")}</span> : <strong>{notificationTitle(notification.type, notification.context?.kind, locale, notification.title)}</strong>}
                </span>
                {notification.context?.kind === "announcement" ? <>
                  <span className="chat-announcement-notification-title">{notification.context.announcement?.title || notification.title}</span>
                  <small className="chat-announcement-notification-summary">{notification.context.announcement?.summary || notification.body}</small>
                </> : null}
                {notification.context?.group?.name ? <small className="chat-notification-group-name">{notification.context.group.name}</small> : null}
                {notification.context?.kind !== "announcement" && notification.context?.kind !== "group_report" ? <small>{notification.context?.kind === "friend_request" && notification.context.requestNote ? notification.context.requestNote : notification.context?.kind === "stranger_message_request" && notification.context.requestBody ? notification.context.requestBody : notification.body}</small> : null}
                {notification.context?.commentBody ? <q>{notification.context.commentBody}</q> : null}
                {notification.context && !notification.context.actionable && notification.context.status ? <em>{notificationStatusLabel(notification.context.kind, notification.context.status, locale)}</em> : null}
              </span></button>
              {notification.context?.kind === "group_report" && notification.context.message ? <NotificationReportContent message={notification.context.message} onPreview={onPreview} /> : null}
            </div>
            <div className="chat-notification-meta">
              <time>{formatChatTime(notification.updatedAt || notification.createdAt, locale)}</time>
              {notification.context?.actionable && (notification.context.kind === "friend_request" || notification.context.kind === "stranger_message_request" || notification.context.kind === "group_invitation" || notification.context.kind === "group_join_request") ? <div className="chat-notification-inline-actions"><button disabled={isActionRunning} onClick={() => onGroupAction(notification, "accept")} type="button"><Check aria-hidden="true" size={13} />{phrase("同意", "Accept")}</button><button disabled={isActionRunning} onClick={() => onGroupAction(notification, "reject")} type="button"><X aria-hidden="true" size={13} />{phrase("拒绝", "Decline")}</button></div> : null}
              {notification.context?.actionable && notification.context.kind === "group_report" ? <div className="chat-notification-inline-actions"><button disabled={isActionRunning} onClick={() => onGroupAction(notification, "resolve-report")} type="button"><Check aria-hidden="true" size={13} />{phrase("处理", "Resolve")}</button><button disabled={isActionRunning} onClick={() => onGroupAction(notification, "reject-report")} type="button"><X aria-hidden="true" size={13} />{phrase("驳回", "Reject")}</button></div> : null}
            </div>
          </div>
          {notification.context?.article ? <button className="chat-system-article-link" onClick={() => onOpenArticle(notification.context?.article?.slug ?? "")} type="button"><FileText aria-hidden="true" size={15} /><span><small>{phrase("相关文章", "Related article")}</small><strong>{notification.context.article.title}</strong></span><ChevronLeft aria-hidden="true" size={15} /></button> : null}
        </article>;
      }) : <div className="chat-empty"><NotificationChannelIcon channel={channel} size={26} /><strong>{phrase("暂时没有消息", "No messages yet")}</strong><span>{emptyText}</span></div>}
    </div>
    {isSelectionMode ? <div className="chat-message-selection-bar chat-notification-selection-bar">
      <button disabled={isActionRunning} onClick={onCancelSelection} type="button"><X aria-hidden="true" size={14} />{phrase("取消", "Cancel")}</button>
      <strong>{phrase(`已选 ${selectedIds.size} 条`, `${selectedIds.size} selected`)}</strong>
      <button disabled={isActionRunning || !selectedUnopenedCount} onClick={onMarkSelectedRead} type="button"><Bell aria-hidden="true" size={14} />{phrase("标为已读", "Mark as read")}</button>
      <button className="danger" disabled={isActionRunning || !selectedIds.size} onClick={onDeleteSelected} type="button"><Trash2 aria-hidden="true" size={14} />{phrase("删除", "Delete")}</button>
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
  const { phrase } = useLanguage();
  const group = notification.context?.group;
  const useGroup = Boolean(group && (notification.context?.kind === "group_invitation" || notification.context?.kind === "group_report"));
  if (useGroup && group) {
    return <button aria-label={phrase(`查看群聊 ${group.name}`, `View group ${group.name}`)} className="chat-notification-identity" onClick={() => onOpenGroup(group.id)} title={phrase("查看群资料", "View group details")} type="button"><span className="chat-user-avatar chat-group-conversation-avatar">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : Array.from(group.name.trim()).slice(-2).join("").toUpperCase()}</span></button>;
  }
  if (notification.actor) {
    return <button aria-label={phrase(`查看 ${notification.actor.nickname} 的主页`, `View ${notification.actor.nickname}'s profile`)} className="chat-notification-identity" onClick={() => onOpenProfile(notification.actor!.username)} title={phrase("查看主页", "View profile")} type="button"><UserAvatar user={notification.actor} /></button>;
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

function notificationStatusLabel(kind: NonNullable<SocialNotification["context"]>["kind"], status: string, locale: "zh-CN" | "en-US"): string {
  const text = (chinese: string, english: string) => locale === "en-US" ? english : chinese;
  if (status === "already_joined") return text("您已加入该群聊", "You have joined this group");
  if (kind === "friend_request") {
    if (status === "accepted") return text("好友申请已接受", "Friend request accepted");
    if (status === "declined") return text("好友申请已拒绝", "Friend request declined");
    if (status === "blocked") return text("该好友关系已被拉黑", "This friendship is blocked");
    return text("好友申请已失效", "Friend request is no longer available");
  }
  if (kind === "stranger_message_request") {
    if (status === "accepted") return text("消息请求已接受", "Message request accepted");
    if (status === "declined") return text("消息请求已拒绝", "Message request declined");
    return text("消息请求已失效", "Message request is no longer available");
  }
  if (kind === "group_report") return status === "rejected" ? text("举报已驳回", "Report rejected") : text("举报已处理", "Report resolved");
  if (kind === "article_report" || kind === "comment_report") {
    if (status === "pending") return text("待处理", "Pending");
    if (status === "resolved") return text("举报已处理", "Report resolved");
    if (status === "rejected") return text("举报已驳回", "Report rejected");
  }
  if (status === "accepted" || status === "approved") return text("已通过", "Approved");
  if (status === "declined" || status === "rejected") return text("已拒绝", "Declined");
  if (status === "expired") return text("邀请已过期", "Invitation expired");
  return text("操作已失效", "Action is no longer available");
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
  const { locale, phrase } = useLanguage();
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
    aria-label={selected ? phrase("取消选择消息", "Deselect message") : phrase("选择消息", "Select message")}
    aria-pressed={selected}
    className="chat-message-selector"
    onClick={onToggleSelection}
    type="button"
  >{selected ? <Check aria-hidden="true" size={13} /> : null}</button> : null;

  if (message.type === "system") {
    return <div aria-selected={selectionMode ? selected : undefined} className={`chat-system-row${selectionMode ? " selection-mode" : ""}${selected ? " selected" : ""}`} onClickCapture={handleSelectionClick} onContextMenu={handleContextMenu} onPointerCancel={handlePointerEnd} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd}>
      {selectionControl}
      {callType ? <button className="chat-call-message" onClick={onCall} title={callType === "voice" ? phrase("再次发起语音通话", "Start another voice call") : phrase("再次发起视频通话", "Start another video call")} type="button">
        {callType === "voice" ? <Phone aria-hidden="true" size={14} /> : <Video aria-hidden="true" size={14} />}
        <span>{message.body}</span>
      </button> : <span>{message.body}</span>}
      {message.body === "你们已经成为好友，可以开始聊天了。" ? <button onClick={onGreeting} type="button">{phrase("打个招呼", "Say hello")}</button> : null}
      <time>{formatChatTime(message.createdAt, locale)}</time>
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
      <span>{formatChatTime(message.createdAt, locale)}{mine && showReadReceipt ? ` · ${message.readAt ? phrase("已读", "Read") : phrase("未读", "Unread")}` : ""}</span>
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
  const { phrase } = useLanguage();
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
      setError(downloadError instanceof Error ? downloadError.message : phrase("附件下载失败。", "Attachment download failed."));
    } finally {
      setIsDownloading(false);
    }
  }
  return <><button className="chat-file-attachment" onClick={() => void download()} type="button"><FileText aria-hidden="true" size={22} /><span><strong title={attachment.originalName}>{attachment.originalName}</strong><small>{formatFileSize(attachment.sizeBytes)}</small></span>{isDownloading ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Download aria-hidden="true" size={16} />}</button><AppToast duration={4200} message={error} onDismiss={() => setError("")} tone="error" /></>;
}

function AttachmentPreview({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  const { t } = useLanguage();
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
  return <div className="chat-attachment-preview" onClick={onClose} role="presentation"><button aria-label={t("common.close")} onClick={onClose} title={t("common.close")} type="button"><X aria-hidden="true" size={22} /></button>{url ? <img alt={attachment.originalName} onClick={(event) => event.stopPropagation()} src={url} /> : <LoaderCircle aria-hidden="true" className="spin" size={26} />}</div>;
}

function UserAvatar({ user, large = false }: { user: SocialUser; large?: boolean }) {
  const avatar = user.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  return <span className={`chat-user-avatar identity-avatar-host${large ? " large" : ""}`}><span className="identity-avatar-visual">{avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText(user)}</span><AvatarManagementBadge user={user} /></span>;
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

function getConversationPreview(conversation: Conversation, locale: "zh-CN" | "en-US"): string {
  const text = (chinese: string, english: string) => locale === "en-US" ? english : chinese;
  if (!conversation.lastMessage) return text("开始聊天", "Start chatting");
  if (conversation.lastMessage.body) return conversation.lastMessage.body;
  const attachments = conversation.lastMessage.attachments ?? [];
  if (attachments.length === 1 && attachments[0].kind === "audio") return text("[语音消息]", "[Voice message]");
  if (attachments.length === 1 && attachments[0].kind === "video") return text("[视频]", "[Video]");
  const count = attachments.length;
  return count ? text(`[${count} 个附件]`, `[${count} attachments]`) : text("新消息", "New message");
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatChatTime(value: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatMinute(value: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === "en-US" ? "Later" : "稍后";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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

function browserPushDescription(state: BrowserPushState | null, locale: "zh-CN" | "en-US"): string {
  const text = (chinese: string, english: string) => locale === "en-US" ? english : chinese;
  if (!state) return text("正在检查当前浏览器", "Checking this browser");
  if (!state.supported) return text("当前浏览器不支持 Web Push", "This browser does not support Web Push");
  if (!state.enabled) return text("服务器尚未配置推送服务", "The server has not configured push notifications");
  if (state.permission === "denied") return text("通知权限已被浏览器阻止", "Browser notification permission is blocked");
  if (state.subscribed) return text("已在当前设备开启", "Enabled on this device");
  return text("关闭网页后也可接收新消息", "Receive new messages even when this page is closed");
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
