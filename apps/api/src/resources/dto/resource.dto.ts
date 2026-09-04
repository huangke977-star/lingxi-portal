import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ResourceAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  username!: string;

  @IsInt()
  @Min(1)
  @Max(1000000)
  points!: number;

  @IsString()
  @MaxLength(80)
  eventKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class ResourceViolationDto extends ResourceAdjustmentDto {}

export class ResourceFailureDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  error?: string;
}
