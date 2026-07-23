import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

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
  @IsString()
  @MaxLength(2000)
  body!: string;
}
