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

export interface AdminAnalyticsResponse {
  range: 7 | 30 | 90;
  generatedAt: string;
  summary: Omit<AnalyticsTrendPoint, "date">;
  trend: AnalyticsTrendPoint[];
}
