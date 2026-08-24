import { Inject, Injectable, forwardRef } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { ArticlesService } from "../articles/articles.service";
import { ChatGroupsService } from "../social/chat-groups.service";
import { BulkHandleModerationReportsDto } from "./dto/moderation.dto";

@Injectable()
export class ModerationWorkflowService {
  constructor(
    @Inject(forwardRef(() => ArticlesService)) private readonly articlesService: ArticlesService,
    @Inject(forwardRef(() => ChatGroupsService)) private readonly chatGroupsService: ChatGroupsService,
  ) {}

  async handleBatch(user: AuthenticatedUser, dto: BulkHandleModerationReportsDto): Promise<{
    succeeded: number[];
    failed: Array<{ id: number; message: string }>;
  }> {
    const ids = [...new Set(dto.reportIds)];
    const succeeded: number[] = [];
    const failed: Array<{ id: number; message: string }> = [];
    for (const id of ids) {
      try {
        if (dto.source === "article") {
          await this.articlesService.moderateArticleReport(id, user, {
            status: dto.status,
            resolution: dto.resolution,
          });
        } else if (dto.source === "comment") {
          await this.articlesService.moderateCommentReport(id, user, {
            status: dto.status,
            resolution: dto.resolution,
          });
        } else {
          await this.chatGroupsService.handleReport(user, id, {
            status: dto.status,
            resolution: dto.resolution,
            deleteMessage: false,
          });
        }
        succeeded.push(id);
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : "处理失败。" });
      }
    }
    return { succeeded, failed };
  }
}
