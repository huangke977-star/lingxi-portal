export interface HttpMonitoringEvent {
  occurredAt: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  message: string | null;
}

export interface MemoryTrendPoint {
  recordedAt: string;
  rssBytes: number;
  heapUsedBytes: number;
}

export interface DiskTrendPoint {
  recordedAt: string;
  capacityBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

export interface LightweightMonitoringSnapshot {
  retentionMinutes: number;
  slowRequestThresholdMs: number;
  slowRequests: HttpMonitoringEvent[];
  recentErrors: HttpMonitoringEvent[];
  memoryTrend: MemoryTrendPoint[];
  diskTrend: DiskTrendPoint[];
}
