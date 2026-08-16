import type { ReputationReason } from "../generated/prisma/client";

export interface ReputationLevelResponse {
  code: string;
  name: string;
  level: number;
  minExperience: number;
}

export interface ReputationRuleResponse {
  reason: ReputationReason;
  label: string;
  experience: number;
  points: number;
  dailyExperienceCap: number | null;
}

export interface ReputationLedgerResponse {
  id: number;
  reason: ReputationReason;
  description: string;
  experienceDelta: number;
  pointDelta: number;
  pendingPointDelta: number;
  experienceAfter: number;
  pointsAfter: number;
  availableAt: string | null;
  settledAt: string | null;
  createdAt: string;
}

export interface ReputationSummaryResponse {
  experience: number;
  points: number;
  pendingPoints: number;
  level: ReputationLevelResponse;
  nextLevel: ReputationLevelResponse | null;
  experienceToNext: number;
  progressPercent: number;
  rules: ReputationRuleResponse[];
  recent: ReputationLedgerResponse[];
}
