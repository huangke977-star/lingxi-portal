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
  url: string;
  tag: string;
  icon?: string;
  badge?: string;
}
