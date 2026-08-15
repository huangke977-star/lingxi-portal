import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class ListAnonymousTopicsQueryDto {
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
  pageSize = 8;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class GetAnonymousTopicQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 40;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeSequence?: number;
}

export class CreateAnonymousTopicDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(32)
  nickname!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  visitorKey!: string;
}

export class ClaimAnonymousIdentityDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;

  @IsOptional()
  @IsBoolean()
  create?: boolean;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  visitorKey!: string;
}

export class CreateAnonymousMessageDto {
  @IsString()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  identityToken?: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  visitorKey!: string;
}

export class ReactAnonymousMessageDto {
  @IsIn(["up", "down"])
  value!: "up" | "down";

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  visitorKey!: string;
}

export class UpdateAnonymousTopicDto {
  @IsOptional()
  @IsIn(["active", "closed"])
  status?: "active" | "closed";

  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;
}

export class UpdateAnonymousTopicByCreatorDto {
  @IsIn(["active", "closed"])
  status!: "active" | "closed";

  @IsString()
  @MinLength(16)
  @MaxLength(2000)
  identityToken!: string;
}

export class UpdateAnonymousMessageDto {
  @IsBoolean()
  isHidden!: boolean;
}
