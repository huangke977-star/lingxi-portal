import { ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, UserStatus } from '../auth/auth.types';

interface UserRecord {
  id: number;
  username: string;
  email: string;
  passwordHash?: string;
  status: string;
  isSuperAdmin: boolean;
  role: {
    code: string;
    name: string;
    level: number;
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  private userSelect() {
    return {
      id: true,
      username: true,
      email: true,
      status: true,
      isSuperAdmin: true,
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
      role: {
        code: user.role.code,
        name: user.role.name,
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
}
