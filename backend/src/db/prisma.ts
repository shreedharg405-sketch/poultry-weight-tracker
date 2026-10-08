import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

export async function testDbConnection(): Promise<boolean> {
  try {
    await prisma.$connect();
    return true;
  } catch (err) {
    console.warn('Prisma database connection failed, falling back to local memory store:', err);
    return false;
  }
}
