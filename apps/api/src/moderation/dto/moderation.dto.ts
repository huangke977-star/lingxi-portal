import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

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
