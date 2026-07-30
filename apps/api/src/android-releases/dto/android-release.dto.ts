import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UploadAndroidReleaseDto {
  @IsString()
  @Length(1, 40)
  versionName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  versionCode!: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  releaseNotes?: string;

  @IsOptional()
  @IsBooleanString()
  activate?: string;
}
