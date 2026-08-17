import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export const FEEDBACK_CATEGORIES = ["bug", "account", "content", "payment", "other"] as const;
export const FEEDBACK_STATUSES = ["pending", "in_progress", "resolved", "closed"] as const;

export class ListFeedbackQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 12;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(FEEDBACK_STATUSES)
  status?: (typeof FEEDBACK_STATUSES)[number];
}

export class CreateFeedbackDto {
  @IsIn(FEEDBACK_CATEGORIES)
  category!: (typeof FEEDBACK_CATEGORIES)[number];

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(5000)
  content!: string;
}

export class UpdateFeedbackStatusDto {
  @IsIn(FEEDBACK_STATUSES)
  status!: (typeof FEEDBACK_STATUSES)[number];
}

export class ReplyFeedbackDto {
  @IsString()
  @MaxLength(3000)
  content!: string;
}
