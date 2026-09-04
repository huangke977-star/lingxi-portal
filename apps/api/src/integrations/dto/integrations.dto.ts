import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from "class-validator";

export const READ_ONLY_SCOPES = ["read_articles", "read_profile", "read_notifications"] as const;
export type ReadOnlyScope = (typeof READ_ONLY_SCOPES)[number];

export class CreateWebhookDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsUrl({ protocols: ["https"], require_protocol: true }) @MaxLength(512) url!: string;
  @IsString() @MinLength(16) @MaxLength(255) secret!: string;
  @IsArray() @IsString({ each: true }) @MaxLength(80, { each: true }) events!: string[];
}

export class UpdateWebhookDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsUrl({ protocols: ["https"], require_protocol: true }) @MaxLength(512) url?: string;
  @IsOptional() @IsString() @MinLength(16) @MaxLength(255) secret?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(80, { each: true }) events?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class CreateReadOnlyTokenDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsArray() @IsIn(READ_ONLY_SCOPES, { each: true }) scopes!: ReadOnlyScope[];
  @IsOptional() @IsString() @MaxLength(32) expiresAt?: string;
}

export class CreateExternalChannelDto {
  @IsIn(["webhook"]) kind!: "webhook";
  @IsUrl({ protocols: ["https"], require_protocol: true }) @MaxLength(512) endpoint!: string;
  @IsOptional() @IsString() @MaxLength(255) secret?: string;
  @IsOptional() preferences?: Record<string, boolean>;
}

export class VerifyExternalChannelDto {
  @IsString() @MinLength(6) @MaxLength(6) code!: string;
}

export class UpdateExternalChannelDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() preferences?: Record<string, boolean>;
}

export class ReadOnlyArticlesQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) limit = 20;
}
