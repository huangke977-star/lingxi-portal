import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export const AI_PROVIDERS = ["openai-compatible", "anthropic", "google"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_ARTICLE_OPERATIONS = [
  "title",
  "outline",
  "summary",
  "taxonomy",
  "polish",
  "rewrite",
  "expand",
  "shorten",
  "correct",
  "format",
] as const;
export type AiArticleOperation = (typeof AI_ARTICLE_OPERATIONS)[number];

export class UpdateAiConfigurationDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(AI_PROVIDERS)
  provider!: AiProvider;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  globalConcurrency!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  userConcurrency!: number;

  @Type(() => Number)
  @IsInt()
  @Min(256)
  @Max(8000)
  maxOutputTokens!: number;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(300)
  requestTimeoutSeconds!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  dailyRequestLimit!: number;

  @IsIn(["USD", "CNY"])
  billingCurrency!: "USD" | "CNY";

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000000)
  inputCostPerMillionMicros!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000000)
  outputCostPerMillionMicros!: number;
}

export class ArticleAssistantDto {
  @IsIn(AI_ARTICLE_OPERATIONS)
  operation!: AiArticleOperation;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(59000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30000)
  selectedText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;

  @IsOptional()
  @IsIn(["zh-CN", "en-US"])
  locale?: "zh-CN" | "en-US";
}
