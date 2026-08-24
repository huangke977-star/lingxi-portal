import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export type ModerationReportSource = "article" | "comment" | "group_message";

export class ListModerationReportsQueryDto {
  @IsOptional()
  @IsIn(["article", "comment", "group_message"])
  type?: ModerationReportSource;

  @IsOptional()
  @IsIn(["pending", "resolved", "rejected", "all"])
  status: "pending" | "resolved" | "rejected" | "all" = "pending";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export const MODERATION_RULE_TYPES = ["sensitive_word", "link_rate", "duplicate_content", "high_frequency"] as const;
export type ModerationRuleTypeValue = (typeof MODERATION_RULE_TYPES)[number];
export const MODERATION_RULE_ACTIONS = ["record", "block"] as const;
export type ModerationRuleActionValue = (typeof MODERATION_RULE_ACTIONS)[number];

export class CreateModerationRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsIn(MODERATION_RULE_TYPES)
  type!: ModerationRuleTypeValue;

  @IsOptional()
  @IsIn(MODERATION_RULE_ACTIONS)
  action?: ModerationRuleActionValue;

  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(["article", "comment", "group_message"], { each: true })
  sources!: ModerationReportSource[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  keywords?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  threshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(86_400)
  windowSeconds?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateModerationRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(MODERATION_RULE_ACTIONS)
  action?: ModerationRuleActionValue;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(["article", "comment", "group_message"], { each: true })
  sources?: ModerationReportSource[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  keywords?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  threshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(86_400)
  windowSeconds?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListModerationRuleHitsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class CreateModerationTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsIn(["resolved", "rejected"])
  status!: "resolved" | "rejected";

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  content!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateModerationTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(["resolved", "rejected"])
  status?: "resolved" | "rejected";

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  content?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateModerationSettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  deadlineHours!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(167)
  reminderLeadHours!: number;

  @IsBoolean()
  automaticRemindersEnabled!: boolean;
}

export class BulkHandleModerationReportsDto {
  @IsIn(["article", "comment", "group_message"])
  source!: ModerationReportSource;

  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  reportIds!: number[];

  @IsIn(["resolved", "rejected"])
  status!: "resolved" | "rejected";

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  resolution!: string;
}
