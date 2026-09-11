import { AiProvider } from "./dto/ai.dto";

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiProviderUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AiProviderCompletion {
  text: string;
  usage: AiProviderUsage;
}

export interface AiProviderRequest {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  timeoutSeconds: number;
  messages: AiChatMessage[];
}

export class AiProviderClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderClientError";
  }
}

export async function completeWithProvider(input: AiProviderRequest): Promise<AiProviderCompletion> {
  if (input.provider === "openai-compatible") {
    return completeOpenAiCompatible(input);
  }
  if (input.provider === "anthropic") {
    return completeAnthropic(input);
  }
  return completeGoogle(input);
}

async function completeOpenAiCompatible(input: AiProviderRequest): Promise<AiProviderCompletion> {
  const response = await postJson(
    appendEndpoint(input.baseUrl, "chat/completions"),
    {
      model: input.model,
      messages: input.messages,
      max_tokens: input.maxOutputTokens,
    },
    { Authorization: `Bearer ${input.apiKey}` },
    input.timeoutSeconds,
  );
  const text = readString(response, ["choices", 0, "message", "content"]);
  if (!text) throw new AiProviderClientError("AI 服务返回了空内容。");
  const usage = readUsage(response, {
    prompt: ["usage", "prompt_tokens"],
    completion: ["usage", "completion_tokens"],
    total: ["usage", "total_tokens"],
  });
  return { text, usage };
}

async function completeAnthropic(input: AiProviderRequest): Promise<AiProviderCompletion> {
  const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const messages = input.messages.filter((message) => message.role !== "system");
  const response = await postJson(
    appendAnthropicEndpoint(input.baseUrl),
    {
      model: input.model,
      max_tokens: input.maxOutputTokens,
      ...(system ? { system } : {}),
      messages,
    },
    { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
    input.timeoutSeconds,
  );
  const text = readTextParts(response, ["content"]);
  if (!text) throw new AiProviderClientError("AI 服务返回了空内容。");
  const usage = readUsage(response, {
    prompt: ["usage", "input_tokens"],
    completion: ["usage", "output_tokens"],
    total: [],
  });
  return { text, usage: withTotal(usage) };
}

async function completeGoogle(input: AiProviderRequest): Promise<AiProviderCompletion> {
  const response = await postJson(
    appendGoogleEndpoint(input.baseUrl, input.model),
    {
      contents: input.messages.filter((message) => message.role !== "system").map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      systemInstruction: input.messages.some((message) => message.role === "system")
        ? { parts: [{ text: input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n") }] }
        : undefined,
      generationConfig: { maxOutputTokens: input.maxOutputTokens },
    },
    {},
    input.timeoutSeconds,
    input.apiKey,
  );
  const text = readTextParts(response, ["candidates", 0, "content", "parts"]);
  if (!text) throw new AiProviderClientError("AI 服务返回了空内容。");
  const usage = readUsage(response, {
    prompt: ["usageMetadata", "promptTokenCount"],
    completion: ["usageMetadata", "candidatesTokenCount"],
    total: ["usageMetadata", "totalTokenCount"],
  });
  return { text, usage };
}

async function postJson(
  endpoint: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  timeoutSeconds: number,
  apiKey?: string,
): Promise<Record<string, unknown>> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AiProviderClientError("AI 接口地址无效。");
  }
  if (apiKey) url.searchParams.set("key", apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AiProviderClientError(`AI 服务请求失败（HTTP ${response.status}）。`);
    }
    try {
      const parsed: unknown = await response.json();
      if (!isRecord(parsed)) throw new Error();
      return parsed;
    } catch {
      throw new AiProviderClientError("AI 服务返回了无效响应。");
    }
  } catch (error) {
    if (error instanceof AiProviderClientError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiProviderClientError("AI 请求超时，请稍后重试。");
    }
    throw new AiProviderClientError("AI 服务暂时无法连接。");
  } finally {
    clearTimeout(timeout);
  }
}

function appendEndpoint(baseUrl: string, suffix: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith(`/${suffix}`) ? base : `${base}/${suffix}`;
}

function appendAnthropicEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/messages")) return base;
  return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
}

function appendGoogleEndpoint(baseUrl: string, model: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.includes(":generateContent")) return base;
  return `${base}/models/${encodeURIComponent(model)}:generateContent`;
}

function readString(value: unknown, path: Array<string | number>): string | null {
  let current = value;
  for (const key of path) {
    if (typeof key === "number" && Array.isArray(current)) current = current[key];
    else if (typeof key === "string" && isRecord(current)) current = current[key];
    else return null;
  }
  return typeof current === "string" ? current.trim() : null;
}

function readTextParts(value: unknown, path: Array<string | number>): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === "number" && Array.isArray(current)) current = current[key];
    else if (typeof key === "string" && isRecord(current)) current = current[key];
    else return null;
  }
  if (!Array.isArray(current)) return null;
  const text = current.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").filter(Boolean).join("").trim();
  return text || null;
}

function readUsage(value: unknown, paths: { prompt: Array<string | number>; completion: Array<string | number>; total: Array<string | number> }): AiProviderUsage {
  return {
    promptTokens: paths.prompt.length ? readNumber(value, paths.prompt) : null,
    completionTokens: paths.completion.length ? readNumber(value, paths.completion) : null,
    totalTokens: paths.total.length ? readNumber(value, paths.total) : null,
  };
}

function withTotal(usage: AiProviderUsage): AiProviderUsage {
  return { ...usage, totalTokens: usage.totalTokens ?? (usage.promptTokens !== null && usage.completionTokens !== null ? usage.promptTokens + usage.completionTokens : null) };
}

function readNumber(value: unknown, path: Array<string | number>): number | null {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === "number" && Array.isArray(current)) current = current[key];
    else if (typeof key === "string" && isRecord(current)) current = current[key];
    else return null;
  }
  return typeof current === "number" && Number.isFinite(current) ? Math.max(0, Math.round(current)) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
