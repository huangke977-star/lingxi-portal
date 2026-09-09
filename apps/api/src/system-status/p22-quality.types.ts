import type { OperationalRunResponse } from "./p21-operations.types";

export type QualityCheckStatus = "passed" | "warning" | "blocked" | "failed";

export interface QualityCheckResponse {
  id: string;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  status: QualityCheckStatus;
  detail: string;
  detailEn: string;
}

export interface P22QualityOverviewResponse {
  generatedAt: string;
  checks: QualityCheckResponse[];
  latestRun: OperationalRunResponse | null;
  browserChecks: Array<{
    id: string;
    label: string;
    labelEn: string;
    command: string;
    description: string;
    descriptionEn: string;
  }>;
}
