import { Type } from "class-transformer";
import { IsString, MaxLength, ValidateNested } from "class-validator";

export class PushSubscriptionKeysDto {
  @IsString()
  @MaxLength(255)
  p256dh!: string;

  @IsString()
  @MaxLength(255)
  auth!: string;
}

export class PushSubscriptionDto {
  @IsString()
  @MaxLength(4096)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}
