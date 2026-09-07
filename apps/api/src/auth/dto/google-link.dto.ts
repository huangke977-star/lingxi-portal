import { IsObject, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class GoogleLinkPendingTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  pendingToken!: string;
}

export class GoogleLinkPasswordDto extends GoogleLinkPendingTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;
}

export class GoogleLinkCodeDto extends GoogleLinkPendingTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{6}$/)
  code!: string;
}

export class GoogleLinkEmailVerifyDto extends GoogleLinkCodeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;
}

export class VerifyGoogleLinkPasskeyDto extends GoogleLinkPendingTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;

  @IsObject()
  response!: Record<string, unknown>;
}
