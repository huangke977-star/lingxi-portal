import { authHeaders, requestJson } from "./auth-api";

export type AiProvider = "openai-compatible" | "anthropic" | "google";

export interface AiResourceRecommendation {
  cpuCores: number;
  totalMemoryMiB: number;
  freeMemoryMiB: number;
  globalConcurrency: number;
  userConcurrency: number;
  maxGlobalConcurrency: number;
  maxUserConcurrency: number;
}

export interface AiAdminConfiguration {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  globalConcurrency: number;
  userConcurrency: number;
  maxOutputTokens: number;
  requestTimeoutSeconds: number;
  dailyRequestLimit: number;
  billingCurrency: "USD" | "CNY";
  inputCostPerMillionMicros: number;
  outputCostPerMillionMicros: number;
  recommendation: AiResourceRecommendation;
  encryptionConfigured: boolean;
  updatedAt: string;
}

export interface AiAdminConfigurationUpdate {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
  globalConcurrency: number;
  userConcurrency: number;
  maxOutputTokens: number;
  requestTimeoutSeconds: number;
  dailyRequestLimit: number;
  billingCurrency: "USD" | "CNY";
  inputCostPerMillionMicros: number;
  outputCostPerMillionMicros: number;
}

export function getAiAdminConfiguration(token: string) {
  return requestJson<AiAdminConfiguration>("/ai/admin/configuration", { headers: authHeaders(token), cache: "no-store" });
}

export function updateAiAdminConfiguration(token: string, input: AiAdminConfigurationUpdate) {
  return requestJson<AiAdminConfiguration>("/ai/admin/configuration", { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(input) });
}

export interface AiConnectionTestResult {
  success: true;
  provider: AiProvider;
  model: string;
  durationMs: number;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
}

export interface AiInvocationLog {
  id: number;
  operation: string;
  provider: AiProvider;
  model: string;
  status: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
  estimatedCostMicros: number | null;
  errorSummary: string | null;
  username: string | null;
  nickname: string | null;
  createdAt: string;
}

export interface AiInvocationOverview {
  today: { requests: number; totalTokens: number; estimatedCostMicros: number };
  logs: AiInvocationLog[];
}

export function testAiAdminConnection(token: string) {
  return requestJson<AiConnectionTestResult>("/ai/admin/test-connection", { method: "POST", headers: authHeaders(token) });
}

export function getAiAdminInvocations(token: string) {
  return requestJson<AiInvocationOverview>("/ai/admin/invocations?limit=30", { headers: authHeaders(token), cache: "no-store" });
}
