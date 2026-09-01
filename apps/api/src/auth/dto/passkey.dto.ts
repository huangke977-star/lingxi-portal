import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
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
