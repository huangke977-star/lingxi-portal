import { PasswordService } from '../src/auth/password.service';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';

interface BootstrapEnv {
  ADMIN_USERNAME?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
}

interface BootstrapPrisma {
  role: {
    findUnique(input: { where: { code: string } }): Promise<{ id: number } | null>;
  };
  user: {
    findFirst(input: { where: { OR: Array<{ username?: string; email?: string }> } }): Promise<{ id: number } | null>;
    create(input: { data: BootstrapUserCreateData }): Promise<unknown>;
    update(input: { where: { id: number }; data: BootstrapUserUpdateData }): Promise<unknown>;
  };
}

interface BootstrapUserUpdateData {
  username: string;
  email: string;
  passwordHash: string;
  roleId: number;
  isSuperAdmin: boolean;
  status: 'active';
}

interface BootstrapUserCreateData extends BootstrapUserUpdateData {
  nickname: string;
}

export async function bootstrapAdminFromEnv(
  prisma: BootstrapPrisma,
  env: BootstrapEnv = process.env,
): Promise<{ created: boolean; username: string; email: string }> {
  const username = requireEnv(env, 'ADMIN_USERNAME').trim();
  const email = requireEnv(env, 'ADMIN_EMAIL').trim().toLowerCase();
  const password = requireEnv(env, 'ADMIN_PASSWORD');

  if (username.length < 3 || username.length > 32) {
    throw new Error('ADMIN_USERNAME must be between 3 and 32 characters.');
  }

  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  }

  const administratorRole = await prisma.role.findUnique({
    where: { code: 'administrator' },
  });

  if (!administratorRole) {
    throw new Error('administrator role is not configured. Run prisma seed first.');
  }

  const passwordHash = await new PasswordService().hashPassword(password);
  const data: BootstrapUserUpdateData = {
    username,
    email,
    passwordHash,
    roleId: administratorRole.id,
    isSuperAdmin: true,
    status: 'active',
  };
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { email }],
    },
  });

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data,
    });
    return { created: false, username, email };
  }

  await prisma.user.create({ data: { ...data, nickname: username } });
  return { created: true, username, email };
}

function requireEnv(env: BootstrapEnv, key: keyof BootstrapEnv): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

async function main() {
  const prisma = createPrismaClient();

  try {
    const result = await bootstrapAdminFromEnv(prisma);
    console.log(result.created ? `Super admin ${result.username} created.` : `Super admin ${result.username} updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
