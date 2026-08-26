import { requestJson } from "./auth-api";

export interface AnalyticsTrendPoint {
  date: string;
  newUsers: number;
  activeUsers: number;
  articles: number;
  comments: number;
  messages: number;
  views: number;
  likes: number;
  favorites: number;
  subscriptions: number;
  reports: number;
  disabledUsers: number;
  loginRisks: number;
  failedJobs: number;
  anonymousTopics: number;
  anonymousMessages: number;
  anonymousLikes: number;
  anonymousFavorites: number;
  notifications: number;
  notificationReads: number;
  notificationOpens: number;
  onboardingCompleted: number;
  resourceExchanges: number;
  resourcePointsSpent: number;
  resourcePointsPending: number;
  resourcePointsSettled: number;
}

export interface AnalyticsRankingItem {
  key: string;
  label: string;
  secondary: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

export interface AdminAnalytics {
  range: 7 | 30 | 90;
  generatedAt: string;
  latestAggregateAt: string | null;
  summary: Omit<AnalyticsTrendPoint, "date">;
  notificationConversion: {
    readRate: number;
    openRate: number;
  };
  onboardingConversion: {
    completed: number;
    completionRate: number;
  };
  trend: AnalyticsTrendPoint[];
  rankings: {
    authors: AnalyticsRankingItem[];
    articles: AnalyticsRankingItem[];
    searches: AnalyticsRankingItem[];
    subscriptionGrowth: AnalyticsRankingItem[];
    anonymousTopics: AnalyticsRankingItem[];
  };
  definitions: Array<{ key: string; label: string; definition: string }>;
}

export function getAdminAnalytics(accessToken: string, range: 7 | 30 | 90): Promise<AdminAnalytics> {
  return requestJson(`/analytics/admin?range=${range}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function rebuildAdminAnalytics(accessToken: string, range: 7 | 30 | 90): Promise<{ success: true; days: number; completedAt: string }> {
  return requestJson("/analytics/admin/rebuild", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ range }),
  });
}
