import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MaxLength(12)
  totpCode?: string;
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
