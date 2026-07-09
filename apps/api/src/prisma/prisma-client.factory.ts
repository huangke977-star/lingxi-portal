import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { config } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';

config({ path: '../../.env', quiet: true });

function getDatabaseConfig() {
  const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

  return {
    host: process.env.MYSQL_HOST ?? databaseUrl?.hostname ?? 'localhost',
    port: Number(process.env.MYSQL_PORT ?? databaseUrl?.port ?? 3306),
    user: process.env.MYSQL_USER ?? decodeURIComponent(databaseUrl?.username ?? 'lingxi'),
    password: process.env.MYSQL_PASSWORD ?? decodeURIComponent(databaseUrl?.password ?? ''),
    database:
      process.env.MYSQL_DATABASE ??
      decodeURIComponent(databaseUrl?.pathname.replace(/^\//, '') ?? 'lingxi_portal'),
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 5),
  };
}

export function createPrismaAdapter() {
  return new PrismaMariaDb(getDatabaseConfig());
}

export function createPrismaClient() {
  return new PrismaClient({ adapter: createPrismaAdapter() });
}
