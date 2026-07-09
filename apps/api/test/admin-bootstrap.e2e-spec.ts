import { bootstrapAdminFromEnv } from '../prisma/bootstrap-admin';

describe('admin bootstrap', () => {
  const administratorRole = { id: 9, code: 'administrator', name: '管理员', level: 90 };

  function createPrismaMock() {
    const users: Array<{
      id: number;
      username: string;
      email: string;
      passwordHash: string;
      roleId: number;
      isSuperAdmin: boolean;
      status: 'active' | 'disabled';
    }> = [];

    return {
      users,
      prisma: {
        role: {
          findUnique: jest.fn(async ({ where }: { where: { code: string } }) => {
            return where.code === 'administrator' ? administratorRole : null;
          }),
        },
        user: {
          findFirst: jest.fn(async ({ where }: { where: { OR: Array<{ username?: string; email?: string }> } }) => {
            return (
              users.find((user) =>
                where.OR.some(
                  (condition) =>
                    (condition.username !== undefined && condition.username === user.username) ||
                    (condition.email !== undefined && condition.email === user.email),
                ),
              ) ?? null
            );
          }),
          create: jest.fn(async ({ data }) => {
            const user = { id: users.length + 1, ...data };
            users.push(user);
            return user;
          }),
          update: jest.fn(async ({ where, data }) => {
            const user = users.find((item) => item.id === where.id);
            if (!user) {
              throw new Error('User not found');
            }

            Object.assign(user, data);
            return user;
          }),
        },
      },
    };
  }

  const env = {
    ADMIN_USERNAME: 'admin',
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'Secret123!',
  };

  it('creates a super admin with administrator role', async () => {
    const state = createPrismaMock();

    const result = await bootstrapAdminFromEnv(state.prisma as never, env);

    expect(result.created).toBe(true);
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({
      username: 'admin',
      email: 'admin@example.com',
      roleId: administratorRole.id,
      isSuperAdmin: true,
      status: 'active',
    });
    expect(state.users[0].passwordHash).not.toBe(env.ADMIN_PASSWORD);
  });

  it('updates the existing admin on rerun without creating duplicates', async () => {
    const state = createPrismaMock();

    await bootstrapAdminFromEnv(state.prisma as never, env);
    const result = await bootstrapAdminFromEnv(state.prisma as never, {
      ...env,
      ADMIN_EMAIL: 'admin-new@example.com',
      ADMIN_PASSWORD: 'NewSecret123!',
    });

    expect(result.created).toBe(false);
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({
      username: 'admin',
      email: 'admin-new@example.com',
      isSuperAdmin: true,
      roleId: administratorRole.id,
    });
  });
});
