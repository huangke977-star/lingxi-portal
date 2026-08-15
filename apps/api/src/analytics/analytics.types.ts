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
}
export interface AnalyticsRankingItem {
  key: string;
  label: string;
  secondary: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

export interface AdminAnalyticsResponse {
  range: 7 | 30 | 90;
  generatedAt: string;
  latestAggregateAt: string | null;
  summary: Omit<AnalyticsTrendPoint, "date">;
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
