import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  AnnouncementAudience,
  AnnouncementStatus,
  Prisma,
  UserNotificationChannel,
  UserNotificationType,
  UserStatus,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAnnouncementDto, ListAnnouncementsQueryDto, UpdateAnnouncementDto } from "./dto/announcement.dto";
import { AnnouncementDetailResponse, AnnouncementSummaryResponse } from "./announcements.types";

const ANNOUNCEMENT_TICK_MS = 30_000;
const announcementInclude = {
  allowedRoles: { include: { role: { select: { code: true } } } },
  createdBy: { select: { id: true, username: true, nickname: true } },
  _count: { select: { reads: { where: { confirmedAt: { not: null } } } } },
} satisfies Prisma.AnnouncementInclude;

type AnnouncementRecord = Prisma.AnnouncementGetPayload<{ include: typeof announcementInclude }>;

@Injectable()
export class AnnouncementsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnnouncementsService.name);
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.processLifecycleInBackground(), ANNOUNCEMENT_TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.processLifecycleInBackground(), 5_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async processLifecycleInBackground(): Promise<void> {
    await this.processLifecycle().catch((error) => {
      this.logger.warn(`Announcement lifecycle task failed: ${this.errorMessage(error)}`);
    });
  }

  async listPublic(query: ListAnnouncementsQueryDto) {
    return this.list(query, null, false);
  }

  async listVisible(user: AuthenticatedUser, query: ListAnnouncementsQueryDto) {
    return this.list(query, user, false);
  }

  async getPublic(id: number): Promise<AnnouncementDetailResponse> {
    const item = await this.prisma.announcement.findFirst({
      where: { id, ...this.visibleWhere(null) },
      include: announcementInclude,
    });
    if (!item) throw new NotFoundException("Announcement not found.");
    await this.prisma.announcement.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return this.toDetail({ ...item, viewCount: item.viewCount + 1 }, null, false);
  }

  async getVisible(user: AuthenticatedUser, id: number): Promise<AnnouncementDetailResponse> {
    const item = await this.prisma.announcement.findFirst({
      where: { id, ...this.visibleWhere(user) },
      include: announcementInclude,
    });
    if (!item) throw new NotFoundException("Announcement not found.");
    const now = new Date();
    const read = await this.prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
      create: { announcementId: id, userId: user.id, firstViewedAt: now, lastViewedAt: now },
      update: { viewCount: { increment: 1 }, lastViewedAt: now },
      select: { confirmedAt: true },
    });
    await this.prisma.announcement.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return this.toDetail({ ...item, viewCount: item.viewCount + 1 }, read.confirmedAt, true);
  }

  async getUnreadCount(user: AuthenticatedUser): Promise<{ count: number }> {
    return {
      count: await this.prisma.announcement.count({
        where: {
          ...this.visibleWhere(user),
          reads: { none: { userId: user.id, confirmedAt: { not: null } } },
        },
      }),
    };
  }

  async confirmRead(user: AuthenticatedUser, id: number): Promise<{ confirmedAt: string }> {
    const exists = await this.prisma.announcement.findFirst({
      where: { id, ...this.visibleWhere(user) },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Announcement not found.");
    const confirmedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.announcementRead.upsert({
        where: { announcementId_userId: { announcementId: id, userId: user.id } },
        create: { announcementId: id, userId: user.id, confirmedAt, firstViewedAt: confirmedAt, lastViewedAt: confirmedAt },
        update: { confirmedAt, lastViewedAt: confirmedAt },
      }),
      this.prisma.userNotification.updateMany({
        where: { userId: user.id, announcementId: id, readAt: null },
        data: { readAt: confirmedAt, openedAt: confirmedAt },
      }),
    ]);
    return { confirmedAt: confirmedAt.toISOString() };
  }

  async listAdmin(query: ListAnnouncementsQueryDto) {
    return this.list(query, null, true);
  }

  async getAdmin(id: number): Promise<AnnouncementDetailResponse> {
    const item = await this.prisma.announcement.findUnique({ where: { id }, include: announcementInclude });
    if (!item) throw new NotFoundException("Announcement not found.");
    return this.toDetail(item, null);
  }

  async create(user: AuthenticatedUser, dto: CreateAnnouncementDto): Promise<AnnouncementDetailResponse> {
    const input = await this.normalizeInput(dto);
    const item = await this.prisma.announcement.create({
      data: {
        ...input.data,
        createdById: user.id,
        updatedById: user.id,
        allowedRoles: input.roleIds.length ? { create: input.roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      include: announcementInclude,
    });
    if (item.status === AnnouncementStatus.published) await this.deliver(item.id);
    return this.getAdmin(item.id);
  }

  async update(user: AuthenticatedUser, id: number, dto: UpdateAnnouncementDto): Promise<AnnouncementDetailResponse> {
    const existing = await this.prisma.announcement.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw new NotFoundException("Announcement not found.");
    if (existing.status === AnnouncementStatus.expired) throw new BadRequestException("Expired announcements cannot be edited.");
    const input = await this.normalizeInput(dto);
    await this.prisma.announcement.update({
      where: { id },
      data: {
        ...input.data,
        updatedById: user.id,
        allowedRoles: {
          deleteMany: {},
          ...(input.roleIds.length ? { create: input.roleIds.map((roleId) => ({ roleId })) } : {}),
        },
      },
    });
    if (input.data.status === AnnouncementStatus.published && existing.status !== AnnouncementStatus.published) {
      await this.deliver(id);
    }
    return this.getAdmin(id);
  }

  async publish(user: AuthenticatedUser, id: number): Promise<AnnouncementDetailResponse> {
    const existing = await this.prisma.announcement.findUnique({ where: { id }, include: { allowedRoles: true } });
    if (!existing) throw new NotFoundException("Announcement not found.");
    this.assertPublishable(existing.title, existing.content, existing.audience, existing.allowedRoles.length, existing.expiresAt);
    await this.prisma.announcement.update({
      where: { id },
      data: {
        status: AnnouncementStatus.published,
        publishedAt: new Date(),
        scheduledAt: null,
        deliveryStartedAt: null,
        deliveredAt: null,
        deliveryError: null,
        updatedById: user.id,
      },
    });
    await this.deliver(id);
    return this.getAdmin(id);
  }

  async archive(user: AuthenticatedUser, id: number): Promise<AnnouncementDetailResponse> {
    const result = await this.prisma.announcement.updateMany({
      where: { id },
      data: { status: AnnouncementStatus.archived, updatedById: user.id },
    });
    if (!result.count) throw new NotFoundException("Announcement not found.");
    return this.getAdmin(id);
  }

  async delete(id: number): Promise<{ success: true }> {
    const existing = await this.prisma.announcement.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw new NotFoundException("Announcement not found.");
    const deletableStatuses: AnnouncementStatus[] = [AnnouncementStatus.draft, AnnouncementStatus.scheduled, AnnouncementStatus.archived];
    if (!deletableStatuses.includes(existing.status)) {
      throw new BadRequestException("Published announcements must be archived before deletion.");
    }
    await this.prisma.announcement.delete({ where: { id } });
    return { success: true };
  }

  async processLifecycle(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const now = new Date();
      await this.prisma.announcement.updateMany({
        where: { status: AnnouncementStatus.published, expiresAt: { lte: now } },
        data: { status: AnnouncementStatus.expired },
      });
      const scheduled = await this.prisma.announcement.findMany({
        where: { status: AnnouncementStatus.scheduled, scheduledAt: { lte: now } },
        select: { id: true },
        take: 20,
      });
      for (const item of scheduled) {
        await this.prisma.announcement.update({
          where: { id: item.id },
          data: { status: AnnouncementStatus.published, publishedAt: now, deliveryError: null },
        });
        await this.deliver(item.id);
      }
      const undelivered = await this.prisma.announcement.findMany({
        where: { status: AnnouncementStatus.published, deliveredAt: null, deliveryAttempts: { lt: 5 } },
        select: { id: true },
        take: 10,
      });
      for (const item of undelivered) await this.deliver(item.id);
    } finally {
      this.processing = false;
    }
  }

  private async list(query: ListAnnouncementsQueryDto, user: AuthenticatedUser | null, admin: boolean) {
    const search = query.search?.trim();
    const where: Prisma.AnnouncementWhereInput = admin
      ? {
          ...(query.status ? { status: query.status as AnnouncementStatus } : {}),
          ...(search ? { OR: [{ title: { contains: search } }, { summary: { contains: search } }, { content: { contains: search } }] } : {}),
        }
      : { ...this.visibleWhere(user), ...(search ? { OR: [{ title: { contains: search } }, { summary: { contains: search } }] } : {}) };
    const total = await this.prisma.announcement.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const items = await this.prisma.announcement.findMany({
      where,
      include: {
        ...announcementInclude,
        ...(user ? { reads: { where: { userId: user.id }, select: { confirmedAt: true } } } : {}),
      },
      orderBy: admin
        ? [{ updatedAt: "desc" }, { id: "desc" }]
        : [{ isPinned: "desc" }, { pinOrder: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      items: items.map((item) => this.toSummary(item, user ? item.reads?.[0]?.confirmedAt ?? null : null, Boolean(user))),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  private visibleWhere(user: AuthenticatedUser | null): Prisma.AnnouncementWhereInput {
    const now = new Date();
    const audience: Prisma.AnnouncementWhereInput[] = [{ audience: AnnouncementAudience.public }];
    if (user) {
      audience.push(
        { audience: AnnouncementAudience.authenticated },
        { audience: AnnouncementAudience.role_restricted, allowedRoles: { some: { role: { code: user.role.code } } } },
      );
    }
    return {
      status: AnnouncementStatus.published,
      publishedAt: { lte: now },
      OR: audience,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    };
  }

  private async normalizeInput(dto: CreateAnnouncementDto | UpdateAnnouncementDto) {
    const title = dto.title.trim();
    const content = dto.content.trim();
    const audience = (dto.audience ?? "public") as AnnouncementAudience;
    const requestedStatus = (dto.status ?? "draft") as AnnouncementStatus;
    const scheduledAt = this.parseDate(dto.scheduledAt, "scheduledAt");
    const expiresAt = this.parseDate(dto.expiresAt, "expiresAt");
    const status = requestedStatus;
    const roleCodes = [...new Set((dto.roleCodes ?? []).map((code) => code.trim()).filter(Boolean))];
    const roles = roleCodes.length
      ? await this.prisma.role.findMany({ where: { code: { in: roleCodes } }, select: { id: true, code: true } })
      : [];
    if (roles.length !== roleCodes.length) throw new BadRequestException("One or more announcement roles do not exist.");
    if (audience === AnnouncementAudience.role_restricted && !roles.length) {
      throw new BadRequestException("Role-targeted announcements require at least one role.");
    }
    const now = new Date();
    if (status === AnnouncementStatus.scheduled && (!scheduledAt || scheduledAt <= now)) {
      throw new BadRequestException("Scheduled announcements require a future publish time.");
    }
    const publishAt = status === AnnouncementStatus.published ? now : scheduledAt;
    if (expiresAt && publishAt && expiresAt <= publishAt) {
      throw new BadRequestException("Announcement expiry must be later than its publish time.");
    }
    if (status === AnnouncementStatus.published) this.assertPublishable(title, content, audience, roles.length, expiresAt);
    return {
      data: {
        title,
        summary: dto.summary?.trim() ?? "",
        content,
        audience,
        status,
        isPinned: dto.isPinned ?? false,
        pinOrder: dto.pinOrder ?? 0,
        pushEnabled: dto.pushEnabled ?? true,
        scheduledAt: status === AnnouncementStatus.scheduled ? scheduledAt : null,
        publishedAt: status === AnnouncementStatus.published ? now : null,
        expiresAt,
        deliveryStartedAt: null,
        deliveredAt: null,
        deliveryError: null,
      },
      roleIds: roles.map((role) => role.id),
    };
  }

  private parseDate(value: string | null | undefined, field: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is invalid.`);
    return parsed;
  }

  private assertPublishable(title: string, content: string, audience: AnnouncementAudience, roleCount: number, expiresAt: Date | null): void {
    if (!title || !content) throw new BadRequestException("Announcement title and content are required before publishing.");
    if (audience === AnnouncementAudience.role_restricted && !roleCount) {
      throw new BadRequestException("Role-targeted announcements require at least one role.");
    }
    if (expiresAt && expiresAt <= new Date()) throw new BadRequestException("Announcement expiry must be in the future.");
  }

  private async deliver(id: number): Promise<void> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      include: { allowedRoles: { select: { roleId: true } } },
    });
    if (!announcement || announcement.status !== AnnouncementStatus.published) return;
    await this.prisma.announcement.update({
      where: { id },
      data: { deliveryStartedAt: new Date(), deliveryAttempts: { increment: 1 }, deliveryError: null },
    });
    try {
      const roleIds = announcement.allowedRoles.map((item) => item.roleId);
      const recipients = await this.prisma.user.findMany({
        where: {
          status: UserStatus.active,
          ...(announcement.audience === AnnouncementAudience.role_restricted ? { roleId: { in: roleIds } } : {}),
        },
        select: { id: true },
      });
      if (recipients.length) {
        await this.prisma.userNotification.createMany({
          data: recipients.map(({ id: userId }) => ({
            userId,
            type: UserNotificationType.announcement_published,
            channel: UserNotificationChannel.system,
            title: announcement.title,
            body: announcement.summary || announcement.content.slice(0, 240),
            actionUrl: `/announcements/${announcement.id}`,
            announcementId: announcement.id,
            pushDeliveredAt: announcement.pushEnabled ? null : new Date(),
          })),
          skipDuplicates: true,
        });
      }
      await this.prisma.announcement.update({
        where: { id },
        data: { recipientCount: recipients.length, deliveredAt: new Date(), deliveryError: null },
      });
    } catch (error) {
      await this.prisma.announcement.update({
        where: { id },
        data: { deliveryError: this.errorMessage(error) },
      });
    }
  }

  private toSummary(
    item: AnnouncementRecord & { reads?: Array<{ confirmedAt: Date | null }> },
    confirmedAt: Date | null,
    trackUnread = false,
  ): AnnouncementSummaryResponse {
    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      audience: item.audience,
      status: item.status,
      isPinned: item.isPinned,
      pinOrder: item.pinOrder,
      pushEnabled: item.pushEnabled,
      scheduledAt: item.scheduledAt?.toISOString() ?? null,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      expiresAt: item.expiresAt?.toISOString() ?? null,
      recipientCount: item.recipientCount,
      viewCount: item.viewCount,
      confirmedCount: item._count.reads,
      unread: trackUnread && !confirmedAt,
      roleCodes: item.allowedRoles.map((entry) => entry.role.code),
      createdBy: item.createdBy,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toDetail(item: AnnouncementRecord, confirmedAt: Date | null, trackUnread = false): AnnouncementDetailResponse {
    return {
      ...this.toSummary(item, confirmedAt, trackUnread),
      content: item.content,
      confirmedAt: confirmedAt?.toISOString() ?? null,
      delivery: {
        startedAt: item.deliveryStartedAt?.toISOString() ?? null,
        deliveredAt: item.deliveredAt?.toISOString() ?? null,
        attempts: item.deliveryAttempts,
        error: item.deliveryError,
      },
    };
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  }
}
