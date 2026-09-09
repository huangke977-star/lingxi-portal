export type OperationalRunKind = "recovery_drill" | "alert_check" | "dependency_review" | "load_test" | "retention_cleanup";
export type OperationalRunStatus = "running" | "passed" | "failed" | "blocked";
export type OperationalAlertStatus = "open" | "acknowledged" | "resolved";

export interface AuditRetentionPolicyResponse {
  cleanupEnabled: boolean;
  businessDays: number;
  securityDays: number;
  serverDays: number;
  lastCleanupAt: string | null;
  lastCleanupCount: number;
}

export interface OperationalRunResponse {
  id: number;
  kind: OperationalRunKind | string;
  status: OperationalRunStatus | string;
  provider: string | null;
  summary: string;
  detail: unknown;
  metrics: unknown;
  actorId: number | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface OperationalAlertResponse {
  id: number;
  type: string;
  fingerprint: string;
  severity: "warning" | "critical" | string;
  status: OperationalAlertStatus | string;
  title: string;
  message: string;
  metadata: unknown;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface DependencyAssessmentResponse {
  generatedAt: string;
  source: "package-manifests";
  items: Array<{
    name: string;
    current: string;
    requested: string | null;
    category: "runtime" | "framework" | "database" | "cache" | "base-image";
    status: "pinned" | "range" | "not-found";
    note: string;
  }>;
}

export interface DisasterRecoveryTargetResponse {
  name: string;
  target: string;
  current: string;
  status: "defined" | "unknown";
  measurement: string;
}

export interface P21OperationsOverviewResponse {
  generatedAt: string;
  auditPolicy: AuditRetentionPolicyResponse;
  alerts: OperationalAlertResponse[];
  runs: OperationalRunResponse[];
  dependencyAssessment: DependencyAssessmentResponse;
  recoveryTargets: DisasterRecoveryTargetResponse[];
  loadTestTargets: Array<{ path: string; label: string; labelEn: string; description: string; descriptionEn: string }>;
  externalStorage: {
    ossConfigured: boolean;
    r2Configured: boolean;
    encryptionConfigured: boolean;
    message: string;
  };
}
