import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AiConfiguration } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { SecretCryptoService } from "../security/secret-crypto.service";
import { AiArticleOperation, AiProvider, ArticleAssistantDto, UpdateAiConfigurationDto } from "./dto/ai.dto";
import {
  AiChatMessage,
  AiProviderClientError,
  AiProviderCompletion,
  completeWithProvider,
} from "./ai-provider.client";
import os from "node:os";

export interface ResourceRecommendation {
  cpuCores: number;
  totalMemoryMiB: number;
  freeMemoryMiB: number;
  globalConcurrency: number;
  userConcurrency: number;
  maxGlobalConcurrency: number;
  maxUserConcurrency: number;
}

export interface AiCompletionOptions {
  userId: number;
  operation: string;
  messages: AiChatMessage[];
  allowDisabled?: boolean;
}

class AiGatewayError extends Error {
  constructor(
    public readonly code: "concurrency" | "quota",
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretCryptoService,
    private readonly redis: RedisService,
  ) {}

  async getAdminConfiguration() {
    const config = await this.getConfiguration();
    return this.toAdminResponse(config);
  }

  async updateConfiguration(dto: UpdateAiConfigurationDto) {
    const current = await this.getConfiguration();
    const recommendation = this.getResourceRecommendation();
    if (dto.globalConcurrency > recommendation.maxGlobalConcurrency) {
      throw new BadRequestException(`全站并发不能超过当前服务器保护上限 ${recommendation.maxGlobalConcurrency}。\nGlobal concurrency cannot exceed the server protection limit of ${recommendation.maxGlobalConcurrency}.`);
    }
    if (dto.userConcurrency > recommendation.maxUserConcurrency || dto.userConcurrency > dto.globalConcurrency) {
      throw new BadRequestException("单用户并发不能超过服务器保护上限或全站并发。\nPer-user concurrency cannot exceed the server protection limit or global concurrency.");
    }
    if (dto.enabled && (!dto.model?.trim() || !dto.baseUrl?.trim() || (!current.apiKeyEncrypted && !dto.apiKey?.trim()))) {
      throw new BadRequestException("启用 AI 前请完整填写接口地址、模型和 API Key。\nConfigure the base URL, model, and API key before enabling AI.");
    }
    if (dto.clearApiKey && dto.enabled && !dto.apiKey?.trim()) {
      throw new BadRequestException("启用 AI 时不能清空 API Key。\nAn API key cannot be cleared while AI is enabled.");
    }

    let apiKeyEncrypted = current.apiKeyEncrypted;
    if (dto.clearApiKey) apiKeyEncrypted = null;
    else if (dto.apiKey?.trim()) apiKeyEncrypted = this.crypto.encrypt(dto.apiKey.trim());

    const saved = await this.prisma.aiConfiguration.update({
      where: { id: 1 },
      data: {
        enabled: dto.enabled,
        provider: dto.provider,
        baseUrl: dto.baseUrl?.trim() || null,
        model: dto.model?.trim() || null,
        apiKeyEncrypted,
        globalConcurrency: dto.globalConcurrency,
        userConcurrency: dto.userConcurrency,
        maxOutputTokens: dto.maxOutputTokens,
        requestTimeoutSeconds: dto.requestTimeoutSeconds,
        dailyRequestLimit: dto.dailyRequestLimit,
        billingCurrency: dto.billingCurrency,
        inputCostPerMillionMicros: dto.inputCostPerMillionMicros,
        outputCostPerMillionMicros: dto.outputCostPerMillionMicros,
      },
    });
    return this.toAdminResponse(saved);
  }

  async testConnection(userId: number) {
    const startedAt = Date.now();
    const result = await this.execute({
      userId,
      operation: "test_connection",
      allowDisabled: true,
      messages: [{ role: "user", content: "Reply with OK only." }],
    });
    return {
      success: true,
      provider: result.provider,
      model: result.model,
      durationMs: Date.now() - startedAt,
      usage: result.usage,
    };
  }

  async complete(options: AiCompletionOptions) {
    return this.execute(options);
  }

  async articleAssistant(userId: number, dto: ArticleAssistantDto) {
    const title = dto.title?.trim() ?? "";
    const content = dto.content?.trim() ?? "";
    const selectedText = dto.selectedText?.trim() ?? "";
    if (!title && !content && !selectedText) {
      throw new BadRequestException("请先填写标题或正文，再使用文章助手。\nAdd a title or article content before using the writing assistant.");
    }

    const locale = dto.locale === "en-US" ? "en-US" : "zh-CN";
    const bodyOperations: AiArticleOperation[] = ["polish", "rewrite", "expand", "shorten", "correct", "format"];
    // A selected passage is the complete source for body edits, so avoid sending the full article twice.
    const useSelectedText = Boolean(selectedText) && bodyOperations.includes(dto.operation);
    const result = await this.complete({
      userId,
      operation: `article_assistant_${dto.operation}`,
      messages: [
        {
          role: "system",
          content: locale === "en-US"
            ? "You are a careful article writing assistant. Preserve facts from the supplied material, do not invent sources or claims, and return only the requested result without commentary or code fences."
            : "你是一个谨慎的文章创作助手。必须保留用户材料中的事实，不得编造来源或结论，只返回请求的结果，不要加解释，也不要使用代码围栏。",
        },
        {
          role: "user",
          content: this.buildArticleAssistantPrompt(dto.operation, { title, content: useSelectedText ? "" : content, selectedText: useSelectedText ? selectedText : "", category: dto.category?.trim() ?? "", tags: dto.tags?.trim() ?? "" }, locale),
        },
      ],
    });
    return {
      text: result.text.trim(),
      operation: dto.operation,
      provider: result.provider,
      model: result.model,
      durationMs: result.durationMs,
      usage: result.usage,
    };
  }

  async getAdminInvocationOverview(limit = 30) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [logs, today] = await Promise.all([
      this.prisma.aiInvocationLog.findMany({
        take: safeLimit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { user: { select: { username: true, nickname: true } } },
      }),
      this.prisma.aiInvocationLog.aggregate({
        where: { createdAt: { gte: startOfDay } },
        _count: { _all: true },
        _sum: { totalTokens: true, estimatedCostMicros: true },
      }),
    ]);
    return {
      today: {
        requests: today._count._all,
        totalTokens: today._sum.totalTokens ?? 0,
        estimatedCostMicros: today._sum.estimatedCostMicros ?? 0,
      },
      logs: logs.map((log) => ({
        id: log.id,
        operation: log.operation,
        provider: log.provider as AiProvider,
        model: log.model,
        status: log.status,
        promptTokens: log.promptTokens,
        completionTokens: log.completionTokens,
        totalTokens: log.totalTokens,
        durationMs: log.durationMs,
        estimatedCostMicros: log.estimatedCostMicros,
        errorSummary: log.errorSummary,
        username: log.user?.username ?? null,
        nickname: log.user?.nickname ?? null,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  getResourceRecommendation(): ResourceRecommendation {
    const cpuCores = Math.max(1, Math.min(16, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length));
    const totalMemoryMiB = Math.max(1, Math.round(os.totalmem() / 1024 / 1024));
    const freeMemoryMiB = Math.max(0, Math.round(os.freemem() / 1024 / 1024));
    const effectiveMemoryMiB = Math.min(totalMemoryMiB, freeMemoryMiB + 512);
    const memoryConcurrency = Math.max(1, Math.floor(Math.max(128, effectiveMemoryMiB - 512) / 128));
    const globalConcurrency = Math.max(1, Math.min(4, cpuCores, memoryConcurrency));
    const maxGlobalConcurrency = Math.max(1, Math.min(8, cpuCores * 2, totalMemoryMiB < 1024 ? 2 : 8));
    const maxUserConcurrency = Math.max(1, Math.min(4, maxGlobalConcurrency));
    return {
      cpuCores,
      totalMemoryMiB,
      freeMemoryMiB,
      globalConcurrency,
      userConcurrency: 1,
      maxGlobalConcurrency,
      maxUserConcurrency,
    };
  }

  private async execute(options: AiCompletionOptions) {
    const config = await this.getConfiguration();
    if (!config.enabled && !options.allowDisabled) {
      throw new BadRequestException("AI 功能尚未启用。\nAI features are not enabled.");
    }
    const apiKey = this.readApiKey(config);
    if (!config.baseUrl?.trim() || !config.model?.trim() || !apiKey) {
      throw new BadRequestException("AI 配置不完整，请先填写接口地址、模型和 API Key。\nComplete the AI base URL, model, and API key first.");
    }
    if (!options.messages.length || options.messages.some((message) => !message.content.trim())) {
      throw new BadRequestException("AI 请求内容不能为空。\nAI request content cannot be empty.");
    }
    if (options.messages.some((message) => message.content.length > 60_000) || JSON.stringify(options.messages).length > 120_000) {
      throw new BadRequestException("AI 请求内容过长，请分段处理。\nAI request content is too large; split it into smaller requests.");
    }

    const globalKey = "ai:concurrency:global";
    const userKey = `ai:concurrency:user:${options.userId}`;
    const quotaKey = `ai:quota:global:${this.utcDayKey()}`;
    const leaseSeconds = config.requestTimeoutSeconds + 30;
    let globalAcquired = false;
    let userAcquired = false;
    const startedAt = Date.now();
    try {
      globalAcquired = await this.redis.tryAcquireCounter(globalKey, config.globalConcurrency, leaseSeconds);
      if (!globalAcquired) throw new AiGatewayError("concurrency", "当前 AI 请求较多，请稍后重试。\nAI concurrency is currently full.");
      userAcquired = await this.redis.tryAcquireCounter(userKey, config.userConcurrency, leaseSeconds);
      if (!userAcquired) throw new AiGatewayError("concurrency", "当前账号的 AI 请求较多，请稍后重试。\nYour AI concurrency limit has been reached.");
      if (config.dailyRequestLimit > 0) {
        const quotaReserved = await this.redis.tryAcquireCounter(quotaKey, config.dailyRequestLimit, this.secondsUntilUtcDayEnd());
        if (!quotaReserved) throw new AiGatewayError("quota", "今日 AI 请求次数已用完。\nThe daily AI request limit has been reached.");
      }

      const result = await completeWithProvider({
        provider: config.provider as AiProvider,
        baseUrl: config.baseUrl,
        apiKey,
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
        timeoutSeconds: config.requestTimeoutSeconds,
        messages: options.messages,
      });
      await this.recordInvocation(config, options, "success", result, Date.now() - startedAt);
      return {
        ...result,
        provider: config.provider as AiProvider,
        model: config.model,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const failure = this.toFailure(error);
      await this.recordInvocation(config, options, failure.status, null, Date.now() - startedAt, failure.summary);
      throw this.toHttpException(failure);
    } finally {
      if (userAcquired) await this.releaseCounterSafely(userKey);
      if (globalAcquired) await this.releaseCounterSafely(globalKey);
    }
  }

  private buildArticleAssistantPrompt(
    operation: AiArticleOperation,
    input: { title: string; content: string; selectedText: string; category: string; tags: string },
    locale: "zh-CN" | "en-US",
  ): string {
    const material = [
      `TITLE:\n${input.title || "(empty)"}`,
      `CATEGORY:\n${input.category || "(empty)"}`,
      `TAGS:\n${input.tags || "(empty)"}`,
      `SELECTED TEXT:\n${input.selectedText || "(none)"}`,
      `ARTICLE BODY:\n${input.content || "(empty)"}`,
    ].join("\n\n");
    const instructions: Record<AiArticleOperation, string> = locale === "en-US"
      ? {
        title: "Suggest one concise, accurate article title. Return one line only.",
        outline: "Create a practical outline for this article. Use Markdown headings and bullet points.",
        summary: "Write a concise summary in 2 to 4 sentences.",
        taxonomy: "Suggest one category and up to six short tags. Return exactly two lines: Category: ... and Tags: tag1, tag2.",
        polish: "Polish the selected text if present, otherwise the article body. Keep the meaning and return the complete revised text.",
        rewrite: "Rewrite the selected text if present, otherwise the article body, with clearer structure and natural language. Keep the meaning.",
        expand: "Expand the selected text if present, otherwise the article body, with useful detail. Do not add unsupported facts.",
        shorten: "Shorten the selected text if present, otherwise the article body, while preserving the key meaning.",
        correct: "Correct grammar, spelling, punctuation, and Markdown structure in the selected text if present, otherwise the article body.",
        format: "Improve the Markdown structure of the article. Return Markdown only, using headings, lists, quotes, and code blocks where appropriate.",
      }
      : {
        title: "为文章拟定一个准确、简洁的标题，只返回一行。",
        outline: "为文章整理实用的提纲，使用 Markdown 标题和项目符号。",
        summary: "写一段 2 到 4 句的简洁摘要。",
        taxonomy: "建议一个分类和最多六个简短标签。严格只返回两行：分类：... 和 标签：标签1, 标签2。",
        polish: "如果有选中文字就润色选中文字，否则润色全文。保持原意，返回完整的修改后文本。",
        rewrite: "如果有选中文字就改写选中文字，否则改写全文，让结构更清晰、语言更自然，并保持原意。",
        expand: "如果有选中文字就扩写选中文字，否则扩写全文，补充有用细节，不得添加材料中没有依据的事实。",
        shorten: "如果有选中文字就缩写选中文字，否则缩写全文，保留关键含义。",
        correct: "如果有选中文字就纠正选中文字，否则纠正全文的语法、错别字、标点和 Markdown 结构。",
        format: "优化文章的 Markdown 结构，只返回 Markdown；恰当使用标题、列表、引用和代码块。",
      };
    return locale === "en-US"
      ? `${instructions[operation]}\n\nUse only the following material:\n${material}`
      : `${instructions[operation]}\n\n请仅根据以下材料处理：\n${material}`;
  }

  private async releaseCounterSafely(key: string): Promise<void> {
    try {
      await this.redis.releaseCounter(key);
    } catch {
      // Lease expiry remains the fallback when Redis is interrupted during release.
    }
  }

  private readApiKey(config: AiConfiguration): string | null {
    if (!config.apiKeyEncrypted) return null;
    try {
      return this.crypto.decrypt(config.apiKeyEncrypted);
    } catch {
      return null;
    }
  }

  private toFailure(error: unknown): { status: "failed" | "rejected"; summary: string; code?: AiGatewayError["code"] } {
    if (error instanceof AiGatewayError) return { status: "rejected", summary: error.message, code: error.code };
    if (error instanceof AiProviderClientError) return { status: "failed", summary: error.message };
    return { status: "failed", summary: "AI 服务暂时不可用，请稍后重试。" };
  }

  private toHttpException(failure: { summary: string; code?: AiGatewayError["code"] }) {
    if (failure.code === "concurrency") return new ServiceUnavailableException(failure.summary);
    if (failure.code === "quota") return new HttpException(failure.summary, HttpStatus.TOO_MANY_REQUESTS);
    if (failure.summary.includes("超时")) return new GatewayTimeoutException(failure.summary);
    return new BadGatewayException(failure.summary);
  }

  private async recordInvocation(
    config: AiConfiguration,
    options: AiCompletionOptions,
    status: "success" | "failed" | "rejected",
    result: AiProviderCompletion | null,
    durationMs: number,
    errorSummary?: string,
  ) {
    try {
      const usage = result?.usage ?? { promptTokens: null, completionTokens: null, totalTokens: null };
      await this.prisma.aiInvocationLog.create({
        data: {
          userId: options.userId,
          operation: options.operation.slice(0, 64),
          provider: config.provider,
          model: config.model ?? "",
          status,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          durationMs: Math.max(0, Math.round(durationMs)),
          estimatedCostMicros: this.estimateCost(config, usage),
          errorSummary: errorSummary?.slice(0, 255) ?? null,
        },
      });
    } catch {
      // Logging must never turn a successful provider response into an error.
    }
  }

  private estimateCost(config: AiConfiguration, usage: { promptTokens: number | null; completionTokens: number | null }): number | null {
    if (usage.promptTokens === null && usage.completionTokens === null) return null;
    const input = ((usage.promptTokens ?? 0) * (config.inputCostPerMillionMicros ?? 0)) / 1_000_000;
    const output = ((usage.completionTokens ?? 0) * (config.outputCostPerMillionMicros ?? 0)) / 1_000_000;
    return Math.max(0, Math.round(input + output));
  }

  private utcDayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private secondsUntilUtcDayEnd(): number {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return Math.max(60, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
  }

  private async getConfiguration(): Promise<AiConfiguration> {
    return this.prisma.aiConfiguration.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  private toAdminResponse(config: AiConfiguration) {
    return {
      enabled: config.enabled,
      provider: config.provider as AiProvider,
      baseUrl: config.baseUrl ?? "",
      model: config.model ?? "",
      apiKeyConfigured: Boolean(config.apiKeyEncrypted),
      globalConcurrency: config.globalConcurrency,
      userConcurrency: config.userConcurrency,
      maxOutputTokens: config.maxOutputTokens,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
      dailyRequestLimit: config.dailyRequestLimit,
      billingCurrency: config.billingCurrency ?? "USD",
      inputCostPerMillionMicros: config.inputCostPerMillionMicros ?? 0,
      outputCostPerMillionMicros: config.outputCostPerMillionMicros ?? 0,
      recommendation: this.getResourceRecommendation(),
      encryptionConfigured: this.crypto.isConfigured(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}
