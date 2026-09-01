import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @IsString()
  @MinLength(1)
  account!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  turnstileToken?: string;
}

export class DeviceLoginVerificationDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class DeviceLoginVerificationResendDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;
}

export class TotpLoginVerificationDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  @Matches(/^[A-Za-z0-9]{6}$/)
  code!: string;
}
