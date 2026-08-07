import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { buildSearchFields } from "./search-normalization";

const BACKFILL_BATCH_SIZE = 100;

@Injectable()
export class SearchIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchIndexService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const updated = await this.backfillMissingFields();
      if (updated > 0) this.logger.log(`Backfilled ${updated} search index records.`);
    } catch (error) {
      this.logger.error("Search index backfill failed.", error instanceof Error ? error.stack : String(error));
    }
  }

  async backfillMissingFields(): Promise<number> {
    const delegates = this.prisma as unknown as {
      user?: { findMany?: unknown };
      article?: { findMany?: unknown };
      portalEntry?: { findMany?: unknown };
    };
    if (
      typeof delegates.user?.findMany !== "function" ||
      typeof delegates.article?.findMany !== "function" ||
      typeof delegates.portalEntry?.findMany !== "function"
    ) return 0;
    const [users, articles, entries] = await Promise.all([
      this.prisma.user.findMany({
        where: { OR: [{ searchText: "" }, { searchPinyin: "" }] },
        take: BACKFILL_BATCH_SIZE,
        orderBy: { id: "asc" },
        select: { id: true, username: true, nickname: true, profileBio: true },
      }),
      this.prisma.article.findMany({
        where: { OR: [{ searchText: "" }, { searchPinyin: "" }] },
        take: BACKFILL_BATCH_SIZE,
        orderBy: { id: "asc" },
        select: { id: true, title: true, category: true, tags: true },
      }),
      this.prisma.portalEntry.findMany({
        where: { OR: [{ searchText: "" }, { searchPinyin: "" }] },
        take: BACKFILL_BATCH_SIZE,
        orderBy: { id: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          category: { select: { name: true } },
        },
      }),
    ]);

    const updates = [
      ...users.map((user) => this.prisma.user.update({
        where: { id: user.id },
        data: buildSearchFields([user.username, user.nickname, user.profileBio]),
        select: { id: true },
      })),
      ...articles.map((article) => this.prisma.article.update({
        where: { id: article.id },
        data: buildSearchFields([article.title, article.category, article.tags]),
        select: { id: true },
      })),
      ...entries.map((entry) => this.prisma.portalEntry.update({
        where: { id: entry.id },
        data: buildSearchFields([entry.title, entry.description, entry.category.name]),
        select: { id: true },
      })),
    ];
    if (updates.length) await this.prisma.$transaction(updates);

    if (users.length === BACKFILL_BATCH_SIZE || articles.length === BACKFILL_BATCH_SIZE || entries.length === BACKFILL_BATCH_SIZE) {
      return updates.length + await this.backfillMissingFields();
    }
    return updates.length;
  }
}
