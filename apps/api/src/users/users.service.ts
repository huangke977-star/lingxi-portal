import {
  ForbiddenException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { AuthenticatedUser, UserStatus } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { FALLBACK_PROFILE_BIO, pickDefaultProfileBio } from './default-profile-bios';
import { UpdateUserAppearanceDto } from './dto/update-user-appearance.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';

export const AVATAR_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

interface UserRecord {
  id: number;
  username: string;
  email: string;
  passwordHash?: string;
  status: string;
  isSuperAdmin: boolean;
  appearanceThemeId: string;
  customAccent: string;
  customSurface: string;
  customForeground: string;
  customMuted: string;
  cardAlpha: number;
  glassBlur: number;
  glassTint: string;
  glassTintAlpha: number;
  avatarStoredName: string | null;
  avatarMimeType: string | null;
  avatarOriginalName?: string | null;
  avatarSizeBytes?: number | null;
  profileBio: string | null;
  createdAt: Date;
  role: {
    code: string;
    name: string;
    level: number;
  };
}

interface UploadedAvatarFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface SupportedAvatarFormat {
  extension: string;
  extensions: string[];
  mimeType: string;
  matches: (buffer: Buffer) => boolean;
}

interface ManagedRole {
  id: number;
  code: string;
  name: string;
  level: number;
}

const SUPPORTED_AVATAR_FORMATS: SupportedAvatarFormat[] = [
  {
    extension: '.jpg',
    extensions: ['.jpg', '.jpeg'],
    mimeType: 'image/jpeg',
    matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    extension: '.png',
    extensions: ['.png'],
    mimeType: 'image/png',
    matches: (buffer) =>
      buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extension: '.webp',
    extensions: ['.webp'],
    mimeType: 'image/webp',
    matches: (buffer) =>
      buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

@Injectable()
export class UsersService {
  private readonly avatarUploadDirectory = resolve(
    process.env.AVATAR_UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'avatars'),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async createUser(input: {
    username: string;
    email: string;
    passwordHash: string;
  }): Promise<AuthenticatedUser & { passwordHash: string }> {
    const role = await this.prisma.role.findUnique({
      where: { code: 'qi_refining' },
      select: { id: true },
    });

    if (!role) {
      throw new InternalServerErrorException('Default role is not configured.');
    }

    const user = await this.prisma.user.create({
      data: {
        username: input.username.trim(),
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        roleId: role.id,
        profileBio: pickDefaultProfileBio(),
      },
      select: this.userWithPasswordSelect(),
    });

    return this.toAuthenticatedUserWithPassword(user);
  }

  async findForLogin(account: string): Promise<(AuthenticatedUser & { passwordHash: string }) | null> {
    const normalized = account.trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: normalized }, { email: normalized.toLowerCase() }],
      },
      select: this.userWithPasswordSelect(),
    });

    return user ? this.toAuthenticatedUserWithPassword(user) : null;
  }

  async findActiveById(id: number): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect(),
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('User is disabled.');
    }

    return this.toAuthenticatedUser(user);
  }

  async markLoginSuccess(id: number): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async listUsers(): Promise<AuthenticatedUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { id: 'asc' },
      select: this.userSelect(),
    });

    return users.map((user) => this.toAuthenticatedUser(user));
  }

  async assignRole(actor: AuthenticatedUser, id: number, roleCode: string): Promise<AuthenticatedUser> {
    const target = await this.findUserForManagement(id);
    const role = await this.prisma.role.findUnique({
      where: { code: roleCode },
      select: { id: true, code: true, name: true, level: true },
    });

    if (!role) {
      throw new NotFoundException('Role not found.');
    }

    this.assertCanAssignRole(actor, target, role);

    if (target.role.code === role.code) {
      return target;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { roleId: role.id },
      select: this.userSelect(),
    });

    return this.toAuthenticatedUser(user);
  }

  async setStatus(actor: AuthenticatedUser, id: number, status: UserStatus): Promise<AuthenticatedUser> {
    const target = await this.findUserForManagement(id);
    this.assertCanSetStatus(actor, target);

    if (target.status === status) {
      return target;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { status },
      select: this.userSelect(),
    });

    return this.toAuthenticatedUser(user);
  }

  async updatePassword(actor: AuthenticatedUser, id: number, password: string): Promise<AuthenticatedUser> {
    const target = await this.findUserForManagement(id);
    this.assertCanUpdatePassword(actor, target);

    const passwordHash = await this.passwordService.hashPassword(password);
    const user = await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: this.userSelect(),
    });

    return this.toAuthenticatedUser(user);
  }

  async updateOwnAppearance(id: number, appearance: UpdateUserAppearanceDto): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        appearanceThemeId: appearance.themeId,
        customAccent: appearance.customAccent,
        customSurface: appearance.customSurface,
        customForeground: appearance.customForeground,
        customMuted: appearance.customMuted,
        cardAlpha: appearance.cardAlpha,
        glassBlur: appearance.glassBlur,
        glassTint: appearance.glassTint,
        glassTintAlpha: appearance.glassTintAlpha,
      },
      select: this.userSelect(),
    });

    return this.toAuthenticatedUser(user);
  }

  async updateOwnProfile(id: number, profile: UpdateUserProfileDto): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { profileBio: profile.profileBio },
      select: this.userSelect(),
    });

    return this.toAuthenticatedUser(user);
  }

  async updateOwnAvatar(id: number, file: UploadedAvatarFile | undefined): Promise<AuthenticatedUser> {
    if (!file) {
      throw new BadRequestException('An avatar image file is required.');
    }

    const format = this.validateAvatarFile(file);
    const storedName = `${randomUUID()}${format.extension}`;
    const filePath = this.resolveAvatarPath(storedName);
    await mkdir(this.avatarUploadDirectory, { recursive: true });
    await writeFile(filePath, file.buffer, { flag: 'wx' });

    try {
      const existingUser = await this.prisma.user.findUnique({
        where: { id },
        select: { avatarStoredName: true },
      });
      const previousStoredName = existingUser?.avatarStoredName ?? null;

      const user = await this.prisma.user.update({
        where: { id },
        data: {
          avatarOriginalName: basename(file.originalname).slice(0, 255),
          avatarStoredName: storedName,
          avatarMimeType: format.mimeType,
          avatarSizeBytes: file.size,
        },
        select: this.userSelect(),
      });

      if (previousStoredName) {
        await unlink(this.resolveAvatarPath(previousStoredName)).catch(() => undefined);
      }

      return this.toAuthenticatedUser(user);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async getAvatarFile(storedName: string): Promise<{ filePath: string; mimeType: string }> {
    const filePath = this.resolveAvatarPath(storedName);
    const user = await this.prisma.user.findUnique({
      where: { avatarStoredName: storedName },
      select: { avatarMimeType: true },
    });

    if (!user?.avatarMimeType) {
      throw new NotFoundException('Avatar not found.');
    }

    try {
      await access(filePath);
    } catch {
      throw new NotFoundException('Avatar file not found.');
    }

    return { filePath, mimeType: user.avatarMimeType };
  }

  private userSelect() {
    return {
      id: true,
      username: true,
      email: true,
      status: true,
      isSuperAdmin: true,
      appearanceThemeId: true,
      customAccent: true,
      customSurface: true,
      customForeground: true,
      customMuted: true,
      cardAlpha: true,
      glassBlur: true,
      glassTint: true,
      glassTintAlpha: true,
      avatarStoredName: true,
      avatarMimeType: true,
      profileBio: true,
      createdAt: true,
      role: {
        select: {
          code: true,
          name: true,
          level: true,
        },
      },
    };
  }

  private userWithPasswordSelect() {
    return {
      ...this.userSelect(),
      passwordHash: true,
    };
  }

  private toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status as UserStatus,
      isSuperAdmin: user.isSuperAdmin,
      avatarUrl: user.avatarStoredName ? `/auth/avatars/${user.avatarStoredName}` : null,
      profileBio: user.profileBio?.trim() || FALLBACK_PROFILE_BIO,
      createdAt: user.createdAt,
      appearance: {
        themeId: user.appearanceThemeId,
        customAccent: user.customAccent,
        customSurface: user.customSurface,
        customForeground: user.customForeground,
        customMuted: user.customMuted,
        cardAlpha: user.cardAlpha,
        glassBlur: user.glassBlur,
        glassTint: user.glassTint,
        glassTintAlpha: user.glassTintAlpha,
      },
      role: {
        code: user.role.code,
        name: user.isSuperAdmin ? '超级管理员' : user.role.name,
        level: user.role.level,
      },
    };
  }

  private toAuthenticatedUserWithPassword(user: UserRecord): AuthenticatedUser & { passwordHash: string } {
    if (!user.passwordHash) {
      throw new InternalServerErrorException('Password hash was not selected.');
    }

    return {
      ...this.toAuthenticatedUser(user),
      passwordHash: user.passwordHash,
    };
  }

  private async findUserForManagement(id: number): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect(),
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return this.toAuthenticatedUser(user);
  }

  private assertCanAssignRole(actor: AuthenticatedUser, target: AuthenticatedUser, role: ManagedRole): void {
    if (target.isSuperAdmin) {
      throw new ForbiddenException('The super admin role cannot be changed.');
    }

    if (actor.isSuperAdmin) {
      return;
    }

    if (target.role.level >= actor.role.level || role.level >= actor.role.level) {
      throw new ForbiddenException('Administrators may only assign roles below their own level.');
    }
  }

  private assertCanSetStatus(actor: AuthenticatedUser, target: AuthenticatedUser): void {
    if (target.isSuperAdmin) {
      throw new ForbiddenException('The super admin account cannot be disabled.');
    }

    if (!actor.isSuperAdmin && target.role.level >= actor.role.level) {
      throw new ForbiddenException('Administrators may only change accounts below their own level.');
    }
  }

  private assertCanUpdatePassword(actor: AuthenticatedUser, target: AuthenticatedUser): void {
    if (!actor.isSuperAdmin) {
      throw new ForbiddenException('Only the super admin may update account passwords.');
    }

    if (target.isSuperAdmin && target.id !== actor.id) {
      throw new ForbiddenException('A super admin may only update their own super admin password.');
    }
  }

  private validateAvatarFile(file: UploadedAvatarFile): SupportedAvatarFormat {
    const normalizedMimeType = file.mimetype.toLowerCase();
    const originalExtension = extname(file.originalname).toLowerCase();
    const format = SUPPORTED_AVATAR_FORMATS.find((candidate) => candidate.matches(file.buffer));

    if (!format || normalizedMimeType !== format.mimeType || !format.extensions.includes(originalExtension)) {
      throw new BadRequestException('Only valid JPEG, PNG, or WebP avatar images are accepted.');
    }

    return format;
  }

  private resolveAvatarPath(storedName: string): string {
    if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(storedName) || basename(storedName) !== storedName) {
      throw new NotFoundException('Avatar not found.');
    }

    const filePath = resolve(this.avatarUploadDirectory, storedName);
    if (!filePath.startsWith(`${this.avatarUploadDirectory}${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new NotFoundException('Avatar not found.');
    }

    return filePath;
  }
}
