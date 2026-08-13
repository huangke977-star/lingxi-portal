import { Type } from "class-transformer";
import { IsIn } from "class-validator";

export class AnalyticsQueryDto {
  @Type(() => Number)
  @IsIn([7, 30, 90])
  range: 7 | 30 | 90 = 30;
}

export class RebuildAnalyticsDto extends AnalyticsQueryDto {}
