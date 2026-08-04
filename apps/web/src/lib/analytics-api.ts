import { requestJson } from "./auth-api";

export interface AnalyticsTrendPoint {
  date: string;
  users: number;
  articles: number;
  views: number;
  likes: number;
  favorites: number;
  comments: number;
  subscriptions: number;
}

export interface AdminAnalytics {
  range: 7 | 30 | 90;
  generatedAt: string;
  summary: Omit<AnalyticsTrendPoint, "date">;
  trend: AnalyticsTrendPoint[];
}

export function getAdminAnalytics(accessToken: string, range: 7 | 30 | 90): Promise<AdminAnalytics> {
  return requestJson(`/analytics/admin?range=${range}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
