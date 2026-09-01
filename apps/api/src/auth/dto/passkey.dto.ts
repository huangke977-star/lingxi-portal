import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  MinLength,
} from "class-validator";

export class VerifyPasskeyRegistrationDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;

  @IsObject()
  response!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class VerifyPasskeyLoginDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;

  @IsObject()
  response!: Record<string, unknown>;
}

export class RenamePasskeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class VerifyPasskeyDeletionDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;

  @IsObject()
  response!: Record<string, unknown>;
}

export class PasskeyDeletionPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;
}

export class PasskeyDeletionCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class PasskeyDeletionEmailVerifyDto extends PasskeyDeletionCodeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;
}
