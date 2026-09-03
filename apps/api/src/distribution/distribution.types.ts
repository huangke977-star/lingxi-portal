export interface SubscriptionEmailDeliveryResponse {
  id: number;
  dayKey: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  itemCount: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface SubscriptionEmailSettingsResponse {
  available: boolean;
  enabled: boolean;
  unsubscribedAt: string | null;
  deliveries: SubscriptionEmailDeliveryResponse[];
}
