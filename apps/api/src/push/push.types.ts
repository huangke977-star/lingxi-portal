export interface PushConfigResponse {
  enabled: boolean;
  publicKey: string | null;
}

export interface PushStatusResponse extends PushConfigResponse {
  subscriptionCount: number;
}

export interface BrowserPushPayload {
  title: string;
  body: string;
  titleEn?: string;
  bodyEn?: string;
  locale?: "zh-CN" | "en-US";
  category?: "system" | "subscription" | "interaction";
  url: string;
  tag: string;
  dedupeKey?: string;
  icon?: string;
  badge?: string;
}
