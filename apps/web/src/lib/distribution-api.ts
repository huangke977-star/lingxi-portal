import { requestJson } from "./auth-api";

export interface SubscriptionEmailDelivery {
  id: number;
  dayKey: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  itemCount: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface SubscriptionEmailSettings {
  available: boolean;
  enabled: boolean;
  unsubscribedAt: string | null;
  deliveries: SubscriptionEmailDelivery[];
}

export function getSubscriptionEmailSettings(accessToken: string) {
  return requestJson<SubscriptionEmailSettings>("/distribution/email", { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } });
}

export function updateSubscriptionEmailSettings(accessToken: string, enabled: boolean) {
  return requestJson<SubscriptionEmailSettings>("/distribution/email", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ enabled }),
  });
}

export function unsubscribeSubscriptionEmail(token: string) {
  return requestJson<{ unsubscribed: true }>(`/distribution/email/unsubscribe/${encodeURIComponent(token)}`, { method: "POST" });
}
