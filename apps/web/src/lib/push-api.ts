import { requestJson } from "./auth-api";

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface PushStatus extends PushConfig {
  subscriptionCount: number;
}

export interface BrowserPushState extends PushStatus {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}

export async function getBrowserPushState(accessToken: string): Promise<BrowserPushState> {
  const status = await requestJson<PushStatus>("/push/status", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!supportsBrowserPush()) {
    return { ...status, supported: false, permission: "unsupported", subscribed: false };
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription && status.enabled) await registerPushSubscription(accessToken, subscription);
  return {
    ...status,
    subscriptionCount: subscription ? Math.max(1, status.subscriptionCount) : status.subscriptionCount,
    supported: true,
    permission: Notification.permission,
    subscribed: Boolean(subscription),
  };
}

export async function enableBrowserPush(accessToken: string): Promise<BrowserPushState> {
  if (!supportsBrowserPush()) throw new Error("当前浏览器不支持消息推送。");
  const config = await requestJson<PushConfig>("/push/config", { cache: "no-store" });
  if (!config.enabled || !config.publicKey) throw new Error("服务器尚未配置浏览器推送。");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("浏览器通知权限未开启。");
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(config.publicKey),
  });
  const status = await registerPushSubscription(accessToken, subscription);
  return { ...status, supported: true, permission, subscribed: true };
}

export async function disableBrowserPush(accessToken: string): Promise<BrowserPushState> {
  if (!supportsBrowserPush()) throw new Error("当前浏览器不支持消息推送。");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  let status = await requestJson<PushStatus>("/push/status", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (subscription) {
    status = await requestJson<PushStatus>("/push/subscriptions", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(subscription.toJSON()),
    });
    await subscription.unsubscribe();
  }
  return { ...status, supported: true, permission: Notification.permission, subscribed: false };
}

export async function syncBrowserPushOwner(accessToken: string): Promise<void> {
  if (!supportsBrowserPush()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await registerPushSubscription(accessToken, subscription);
}

function registerPushSubscription(accessToken: string, subscription: PushSubscription): Promise<PushStatus> {
  return requestJson<PushStatus>("/push/subscriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(subscription.toJSON()),
  });
}

function supportsBrowserPush(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
