import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export const AI_PROVIDERS = ["openai-compatible", "anthropic", "google"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

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
