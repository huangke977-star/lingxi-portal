import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreatePortalCategoryDto,
  CreatePortalEntryDto,
  PortalListQueryDto,
  UpdatePortalCategoryDto,
  UpdatePortalEntryDto,
} from "./dto/portal.dto";
import {
  PortalCategoryKind,
  PortalCategoryResponse,
  PortalContentResponse,
  PortalEntryResponse,
  PortalVisibility,
} from "./portal.types";

interface PortalEntryRecord {
  id: number;
  categoryId: number;
  title: string;
  description: string;
  url: string | null;
  iconPath: string | null;
  openInNewTab: boolean;
  visibility: PortalVisibility;
  sortOrder: number;
  status: "active" | "disabled";
  allowedRoles: Array<{
    role: {
      code: string;
      name: string;
      level: number;
    };
  }>;
  createdAt: Date;
  updatedAt: Date;
}

interface PortalCategoryRecord {
  id: number;
  kind: PortalCategoryKind;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  status: "active" | "disabled";
  entries: PortalEntryRecord[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(query: PortalListQueryDto): Promise<PortalContentResponse> {
    return this.listVisible(query, null);
  }

  async listForUser(
    query: PortalListQueryDto,
    user: AuthenticatedUser,
  ): Promise<PortalContentResponse> {
    return this.listVisible(query, user);
  }

  async listAdmin(actor: AuthenticatedUser): Promise<PortalContentResponse> {
    const categories = await this.prisma.portalCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: this.categorySelect(),
    });

    return {
      categories: categories
        .filter((category) => category.kind !== "server" || actor.isSuperAdmin)
        .map((category) => this.toCategoryResponse(category)),
    };
  }

  async createCategory(
    dto: CreatePortalCategoryDto,
    actor: AuthenticatedUser,
  ): Promise<PortalCategoryResponse> {
    this.assertCanManageKind(actor, dto.kind);
    const category = await this.prisma.portalCategory.create({
      data: {
        kind: dto.kind,
        name: dto.name,
        slug: `category-${randomUUID()}`,
        description: dto.description,
        sortOrder: dto.sortOrder,
        status: dto.status,
        createdById: actor.id,
        updatedById: actor.id,
      },
      select: this.categorySelect(),
    });

    return this.toCategoryResponse(category);
  }

  async updateCategory(
    id: number,
    dto: UpdatePortalCategoryDto,
    actor: AuthenticatedUser,
  ): Promise<PortalCategoryResponse> {
    const existing = await this.getCategoryOrThrow(id);
    const targetKind = dto.kind ?? existing.kind;
    this.assertCanManageKind(actor, existing.kind);
    this.assertCanManageKind(actor, targetKind);
    const category = await this.prisma.$transaction(async (transaction) => {
      if (targetKind === "server") {
        const entryIds = await transaction.portalEntry.findMany({
          where: { categoryId: id },
          select: { id: true },
        });
        if (entryIds.length > 0) {
          await transaction.portalEntry.updateMany({
            where: { id: { in: entryIds.map((entry) => entry.id) } },
            data: { visibility: "authenticated", updatedById: actor.id },
          });
          await transaction.portalEntryRole.deleteMany({
            where: { entryId: { in: entryIds.map((entry) => entry.id) } },
          });
        }
      }

      return transaction.portalCategory.update({
        where: { id },
        data: {
          kind: targetKind,
          name: dto.name ?? existing.name,
          description: dto.description ?? existing.description,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          status: dto.status ?? existing.status,
          updatedById: actor.id,
        },
        select: this.categorySelect(),
      });
    });

    return this.toCategoryResponse(category);
  }

  async deleteCategory(id: number, actor: AuthenticatedUser): Promise<void> {
    const category = await this.getCategoryOrThrow(id);
    this.assertCanManageKind(actor, category.kind);
    const entryCount = await this.prisma.portalEntry.count({
      where: { categoryId: id },
    });
    if (entryCount > 0) {
      throw new ConflictException("Delete the entries in this category first.");
    }

    await this.prisma.portalCategory.delete({ where: { id } });
  }

  async createEntry(
    dto: CreatePortalEntryDto,
    actor: AuthenticatedUser,
  ): Promise<PortalEntryResponse> {
    const category = await this.getCategoryOrThrow(dto.categoryId);
    this.assertCanManageKind(actor, category.kind);
    const visibility = this.normalizeVisibility(category.kind, dto.visibility);
    const roleCodes = category.kind === "server" ? [] : (dto.roleCodes ?? []);
    const roles = await this.resolveRoles(visibility, roleCodes);

    const entry = await this.prisma.portalEntry.create({
      data: {
        categoryId: category.id,
        title: dto.title,
        description: dto.description,
        url: dto.url ?? null,
        iconPath: dto.iconPath ?? null,
        openInNewTab: dto.openInNewTab,
        visibility,
        sortOrder: dto.sortOrder,
        status: dto.status,
        createdById: actor.id,
        updatedById: actor.id,
        allowedRoles: {
          create: roles.map((role) => ({ roleId: role.id })),
        },
      },
      select: this.entrySelect(),
    });

    return this.toEntryResponse(entry);
  }

  async updateEntry(
    id: number,
    dto: UpdatePortalEntryDto,
    actor: AuthenticatedUser,
  ): Promise<PortalEntryResponse> {
    const existing = await this.getEntryOrThrow(id);
    const existingCategory = await this.getCategoryOrThrow(existing.categoryId);
    const category = await this.getCategoryOrThrow(
      dto.categoryId ?? existing.categoryId,
    );
    this.assertCanManageKind(actor, existingCategory.kind);
    this.assertCanManageKind(actor, category.kind);
    const visibility = this.normalizeVisibility(
      category.kind,
      dto.visibility ?? existing.visibility,
    );
    const existingRoleCodes = existing.allowedRoles.map(
      ({ role }) => role.code,
    );
    const roleCodes =
      category.kind === "server" ? [] : (dto.roleCodes ?? existingRoleCodes);
    const roles = await this.resolveRoles(visibility, roleCodes);

    const entry = await this.prisma.portalEntry.update({
      where: { id },
      data: {
        categoryId: category.id,
        title: dto.title ?? existing.title,
        description: dto.description ?? existing.description,
        url: dto.url === undefined ? existing.url : dto.url,
        iconPath: dto.iconPath === undefined ? existing.iconPath : dto.iconPath,
        openInNewTab: dto.openInNewTab ?? existing.openInNewTab,
        visibility,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        status: dto.status ?? existing.status,
        updatedById: actor.id,
        allowedRoles: {
          deleteMany: {},
          create: roles.map((role) => ({ roleId: role.id })),
        },
      },
      select: this.entrySelect(),
    });

    return this.toEntryResponse(entry);
  }

  async deleteEntry(id: number, actor: AuthenticatedUser): Promise<void> {
    const entry = await this.getEntryOrThrow(id);
    const category = await this.getCategoryOrThrow(entry.categoryId);
    this.assertCanManageKind(actor, category.kind);
    await this.prisma.portalEntry.delete({ where: { id } });
  }

  private async listVisible(
    query: PortalListQueryDto,
    user: AuthenticatedUser | null,
  ): Promise<PortalContentResponse> {
    const requestedKinds = query.kinds?.length ? new Set(query.kinds) : null;
    const categories = await this.prisma.portalCategory.findMany({
      where: { status: "active" },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: this.categorySelect({ activeEntriesOnly: true }),
    });

    const visibleCategories = categories
      .filter(
        (category) => !requestedKinds || requestedKinds.has(category.kind),
      )
      .filter((category) => category.kind !== "server" || user?.isSuperAdmin)
      .map((category) => ({
        ...category,
        entries: category.entries.filter((entry) =>
          this.isEntryVisible(entry, user),
        ),
      }))
      .filter((category) => category.entries.length > 0)
      .map((category) => this.toCategoryResponse(category));

    return { categories: visibleCategories };
  }

  private isEntryVisible(
    entry: PortalEntryRecord,
    user: AuthenticatedUser | null,
  ): boolean {
    if (user?.isSuperAdmin) {
      return true;
    }
    if (entry.visibility === "public") {
      return true;
    }
    if (!user) {
      return false;
    }
    if (entry.visibility === "authenticated") {
      return true;
    }
    return entry.allowedRoles.some(({ role }) => role.code === user.role.code);
  }

  private normalizeVisibility(
    categoryKind: PortalCategoryKind,
    visibility: PortalVisibility,
  ): PortalVisibility {
    return categoryKind === "server" ? "authenticated" : visibility;
  }

  private assertCanManageKind(
    actor: AuthenticatedUser,
    kind: PortalCategoryKind,
  ): void {
    if (kind === "server" && !actor.isSuperAdmin) {
      throw new ForbiddenException(
        "Only the super administrator may access server entries.",
      );
    }
  }

  private async resolveRoles(
    visibility: PortalVisibility,
    roleCodes: string[],
  ) {
    const normalizedCodes = [
      ...new Set(roleCodes.map((code) => code.trim()).filter(Boolean)),
    ];
    if (visibility !== "role_restricted") {
      return [];
    }
    if (normalizedCodes.length === 0) {
      throw new BadRequestException(
        "At least one role is required for restricted entries.",
      );
    }

    const roles = await this.prisma.role.findMany({
      where: { code: { in: normalizedCodes } },
      select: { id: true, code: true },
    });
    if (roles.length !== normalizedCodes.length) {
      throw new BadRequestException("One or more selected roles do not exist.");
    }

    return roles;
  }

  private async getCategoryOrThrow(id: number) {
    const category = await this.prisma.portalCategory.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        name: true,
        description: true,
        sortOrder: true,
        status: true,
      },
    });
    if (!category) {
      throw new NotFoundException("Portal category not found.");
    }
    return category;
  }

  private async getEntryOrThrow(id: number): Promise<PortalEntryRecord> {
    const entry = await this.prisma.portalEntry.findUnique({
      where: { id },
      select: this.entrySelect(),
    });
    if (!entry) {
      throw new NotFoundException("Portal entry not found.");
    }
    return entry;
  }

  private categorySelect(options: { activeEntriesOnly?: boolean } = {}) {
    return {
      id: true,
      kind: true,
      name: true,
      slug: true,
      description: true,
      sortOrder: true,
      status: true,
      entries: {
        ...(options.activeEntriesOnly
          ? { where: { status: "active" as const } }
          : {}),
        orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
        select: this.entrySelect(),
      },
      createdAt: true,
      updatedAt: true,
    };
  }

  private entrySelect() {
    return {
      id: true,
      categoryId: true,
      title: true,
      description: true,
      url: true,
      iconPath: true,
      openInNewTab: true,
      visibility: true,
      sortOrder: true,
      status: true,
      allowedRoles: {
        orderBy: { role: { level: "asc" as const } },
        select: {
          role: {
            select: {
              code: true,
              name: true,
              level: true,
            },
          },
        },
      },
      createdAt: true,
      updatedAt: true,
    };
  }

  private toCategoryResponse(
    category: PortalCategoryRecord,
  ): PortalCategoryResponse {
    return {
      id: category.id,
      kind: category.kind,
      name: category.name,
      slug: category.slug,
      description: category.description,
      sortOrder: category.sortOrder,
      status: category.status,
      entries: category.entries.map((entry) => this.toEntryResponse(entry)),
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }

  private toEntryResponse(entry: PortalEntryRecord): PortalEntryResponse {
    return {
      id: entry.id,
      categoryId: entry.categoryId,
      title: entry.title,
      description: entry.description,
      url: entry.url,
      iconPath: entry.iconPath,
      openInNewTab: entry.openInNewTab,
      visibility: entry.visibility,
      sortOrder: entry.sortOrder,
      status: entry.status,
      allowedRoles: entry.allowedRoles.map(({ role }) => role),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }
}
