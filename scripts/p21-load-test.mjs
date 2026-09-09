#!/usr/bin/env node

// Read-only smoke/load probe for P21. Keep the default path health-only.
const baseUrl = (process.env.P21_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const paths = (process.env.P21_LOAD_PATHS || "/health")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const concurrency = Math.max(1, Math.min(50, Number(process.env.P21_CONCURRENCY || 4)));
const durationSeconds = Math.max(1, Math.min(300, Number(process.env.P21_DURATION_SECONDS || 15)));
const deadline = Date.now() + durationSeconds * 1000;
const token = process.env.P21_ACCESS_TOKEN || "";
const durations = [];
const errors = [];
let requests = 0;
let succeeded = 0;

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue))];
}

async function worker(workerId) {
  let pathIndex = workerId % paths.length;
  while (Date.now() < deadline) {
    const path = paths[pathIndex++ % paths.length];
    const started = performance.now();
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(12_000) });
      const elapsed = Math.round((performance.now() - started) * 10) / 10;
      requests += 1;
      durations.push(elapsed);
      if (response.ok) succeeded += 1;
      else errors.push({ path, status: response.status });
      await response.body?.cancel();
    } catch (error) {
      requests += 1;
      errors.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
const result = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  paths,
  readOnly: true,
  durationSeconds,
  concurrency,
  requests,
  succeeded,
  failed: requests - succeeded,
  successRate: requests ? Math.round((succeeded / requests) * 10_000) / 100 : 0,
  requestsPerSecond: Math.round((requests / durationSeconds) * 100) / 100,
  latencyMs: {
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    max: durations.length ? Math.max(...durations) : 0,
  },
  sampleErrors: errors.slice(0, 20),
};
console.log(JSON.stringify(result, null, 2));
if (result.failed > 0) process.exitCode = 1;
