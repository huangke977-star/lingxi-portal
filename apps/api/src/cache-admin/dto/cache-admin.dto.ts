import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { RedisKeyType } from "../../redis/redis.service";

const CACHE_KEY_TYPES: Array<Exclude<RedisKeyType, "none">> = [
  "string",
  "list",
  "set",
  "zset",
  "hash",
  "stream",
];

export class ListCacheKeysQueryDto {
  @Transform(({ value }) => (value === undefined ? "0" : String(value)))
  @IsString()
  @Matches(/^\d+$/)
  cursor = "0";

  @Transform(({ value }) => (value === undefined ? 50 : Number(value)))
  @IsInt()
  @Min(10)
  @Max(100)
  count = 50;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @IsOptional()
  @IsIn(CACHE_KEY_TYPES)
  type?: Exclude<RedisKeyType, "none">;
}

export class InspectCacheKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  key!: string;
}

export class DeleteCacheKeysDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(512, { each: true })
  keys!: string[];
}

export class UpdateCacheKeyTtlDto extends InspectCacheKeyDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(60)
  @Max(31_536_000)
  ttlSeconds!: number;
}
