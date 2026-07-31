import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class SearchSocialUsersQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 12;
}

export class ChatMessageIdsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  messageIds!: number[];
}

export class NotificationIdsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  notificationIds!: number[];
}

export class RequestFriendDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}

export class RespondFriendRequestDto {
  @IsIn(["accepted", "declined"])
  status!: "accepted" | "declined";
}

export class ListMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 30;
}

export class SendChatMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsInt({ each: true })
  attachmentIds?: number[];
}

export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsIn(["system", "subscription", "interaction"])
  channel?: "system" | "subscription" | "interaction";
}

export class UpdateConversationSettingsDto {
  @IsBoolean()
  muted!: boolean;
}

export class UpdateNotificationChannelSettingsDto {
  @IsBoolean()
  pushEnabled!: boolean;
}
