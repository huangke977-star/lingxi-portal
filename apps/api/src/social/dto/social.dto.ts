import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
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

export class CreateStrangerMessageRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}

export class RespondStrangerMessageRequestDto {
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

export class CreateChatGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(99)
  @IsInt({ each: true })
  memberIds?: number[];

  @IsOptional()
  @IsBoolean()
  temporary = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  ttlDays = 7;

  @IsOptional()
  @IsIn(["approval", "invite_only"])
  joinMode: "approval" | "invite_only" = "approval";
}

export class UpdateChatGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  announcement?: string;

  @IsOptional()
  @IsIn(["approval", "invite_only"])
  joinMode?: "approval" | "invite_only";

  @IsOptional()
  @IsBoolean()
  membersCanInvite?: boolean;

  @IsOptional()
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(500)
  avatarUrl?: string;
}

export class UpdateChatGroupAliasDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  alias?: string;
}

export class InviteChatGroupMembersDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  userIds!: number[];
}

export class RespondChatGroupInvitationDto {
  @IsIn(["accepted", "declined"])
  status!: "accepted" | "declined";
}

export class RequestChatGroupJoinDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}

export class RespondChatGroupJoinRequestDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";
}

export class UpdateChatGroupMemberDto {
  @IsOptional()
  @IsIn(["admin", "member"])
  role?: "admin" | "member";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(43200)
  mutedMinutes?: number;
}

export class TransferChatGroupOwnerDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;
}

export class ReportChatGroupMessageDto {
  @IsIn(["spam", "harassment", "illegal", "privacy", "misinformation", "other"])
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  detail?: string;
}

export class HandleChatGroupReportDto {
  @IsIn(["resolved", "rejected"])
  status!: "resolved" | "rejected";

  @IsOptional()
  @IsString()
  @MaxLength(300)
  resolution?: string;

  @IsOptional()
  @IsBoolean()
  deleteMessage = false;
}

export class UpdateChatGroupBanDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(525600)
  durationMinutes?: number;

  @IsBoolean()
  permanent!: boolean;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason!: string;
}

export class SearchChatGroupsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q = "";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class ListChatGroupReportsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number;

  @IsOptional()
  @IsIn(["pending", "resolved", "rejected"])
  status?: "pending" | "resolved" | "rejected";
}
