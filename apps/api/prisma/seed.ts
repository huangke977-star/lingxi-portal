import { createPrismaClient } from '../src/prisma/prisma-client.factory';

const prisma = createPrismaClient();

const roles = [
  { code: 'qi_refining', name: '练气', level: 10, sortOrder: 10 },
  { code: 'foundation_building', name: '筑基', level: 20, sortOrder: 20 },
  { code: 'golden_core', name: '金丹', level: 30, sortOrder: 30 },
  { code: 'nascent_soul', name: '元婴', level: 40, sortOrder: 40 },
  { code: 'spirit_transformation', name: '化神', level: 50, sortOrder: 50 },
  { code: 'void_refining', name: '炼虚', level: 60, sortOrder: 60 },
  { code: 'body_integration', name: '合体', level: 70, sortOrder: 70 },
  { code: 'mahayana', name: '大乘', level: 80, sortOrder: 80 },
  { code: 'administrator', name: '管理员', level: 90, sortOrder: 90 },
];

async function main() {
  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        level: role.level,
        sortOrder: role.sortOrder,
      },
      create: role,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
