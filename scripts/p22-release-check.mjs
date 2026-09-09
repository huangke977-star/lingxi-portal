#!/usr/bin/env node

const webBase = (process.env.P22_WEB_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const apiBase = (process.env.P22_API_BASE_URL || (new URL(webBase).port === "3000" ? "http://localhost:3001" : `${webBase}/api`)).replace(/\/$/, "");
const checks = [
  ["api-health", `${apiBase}/health`],
  ["api-readiness", `${apiBase}/health/ready`],
  ["sitemap", `${apiBase}/distribution/sitemap`],
  ["rss", `${apiBase}/distribution/feeds/site.rss`],
  ["home", `${webBase}/`],
  ["english-home", `${webBase}/en`],
  ["manifest", `${webBase}/manifest.webmanifest`],
  ["english-manifest", `${webBase}/en/manifest.webmanifest`],
  ["service-worker", `${webBase}/sw.js`],
];

const results = [];
for (const [id, url] of checks) {
  const started = performance.now();
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const contentType = response.headers.get("content-type") || "";
    await response.arrayBuffer();
    results.push({ id, url, status: response.status, ok: response.ok, contentType, latencyMs: Math.round((performance.now() - started) * 10) / 10 });
  } catch (error) {
    results.push({ id, url, status: null, ok: false, error: error instanceof Error ? error.message : String(error), latencyMs: Math.round((performance.now() - started) * 10) / 10 });
  }
}

const output = { generatedAt: new Date().toISOString(), webBase, apiBase, checks: results, passed: results.every((item) => item.ok) };
console.log(JSON.stringify(output, null, 2));
if (!output.passed) process.exitCode = 1;
