import { requestJson } from "./auth-api";

export type ReputationReason =
  | "article_read"
  | "article_comment"
  | "article_publish"
  | "article_liked"
  | "author_subscribed"
  | "resource_redeemed"
  | "resource_sold"
  | "article_report_accepted";

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
  pendingPointDelta: number;
  availableAt: string | null;
  settledAt: string | null;
}

export interface ReputationSummary {
  experience: number;
  points: number;
  pendingPoints: number;
  level: ReputationLevel;
  nextLevel: ReputationLevel | null;
  experienceToNext: number;
  progressPercent: number;
  rules: ReputationRule[];
  recent: ReputationLedger[];
}

export interface ReputationLedgerPage {
  items: ReputationLedger[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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

export function getMyReputationLedger(accessToken: string, page = 1, pageSize = 20): Promise<ReputationLedgerPage> {
  return requestJson<ReputationLedgerPage>(`/reputation/ledger?page=${page}&pageSize=${pageSize}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}
