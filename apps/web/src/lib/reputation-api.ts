import { requestJson } from "./auth-api";

export type ReputationReason =
  | "article_read"
  | "article_comment"
  | "article_publish"
  | "article_liked"
  | "author_subscribed"
  | "resource_redeemed"
  | "resource_sold";

export interface ReputationLevel {
  code: string;
  name: string;
  level: number;
  minExperience: number;
}

export interface ReputationRule {
  reason: ReputationReason;
  label: string;
  experience: number;
  points: number;
  dailyExperienceCap: number | null;
}

export interface ReputationLedger {
  id: number;
  reason: ReputationReason;
  description: string;
  experienceDelta: number;
  pointDelta: number;
  experienceAfter: number;
  pointsAfter: number;
  createdAt: string;
}

export interface ReputationSummary {
  experience: number;
  points: number;
  level: ReputationLevel;
  nextLevel: ReputationLevel | null;
  experienceToNext: number;
  progressPercent: number;
  rules: ReputationRule[];
  recent: ReputationLedger[];
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

export function getMyReputation(accessToken: string): Promise<ReputationSummary> {
  return requestJson<ReputationSummary>("/reputation/me", {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}
