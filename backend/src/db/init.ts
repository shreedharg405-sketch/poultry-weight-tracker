import { prisma } from './prisma.js';
import { execSync } from 'child_process';

async function initDb() {
  console.log('🔄 Checking PostgreSQL database status...');
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl || !dbUrl.trim() || dbUrl.startsWith('file:')) {
    console.warn('⚠️ No valid PostgreSQL DATABASE_URL configured. App will operate in in-memory simulation mode until DATABASE_URL is added.');
    return;
  }

  try {
    console.log('📦 Applying Prisma schema to PostgreSQL database...');
    execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
    console.log('✅ PostgreSQL schema synchronized successfully.');

    // Check if initial seed is needed
    try {
      const farmCount = await prisma.farm.count();
      if (farmCount === 0) {
        console.log('🌱 Database is empty. Seeding initial farms...');
        execSync('node dist/seed.js', { stdio: 'inherit' });
        console.log('✅ Initial demo farms seeded.');
      } else {
        console.log(`ℹ️ Database already contains ${farmCount} farms. Preserving existing records.`);
      }
    } catch (countErr) {
      console.warn('⚠️ Could not count farms, skipping seed:', countErr);
    }
  } catch (err: any) {
    console.warn('⚠️ Warning: PostgreSQL schema push could not complete:', err?.message || err);
    console.warn('ℹ️ If PostgreSQL is still provisioning on Render, the backend will auto-retry on startup.');
  } finally {
    try {
      await prisma.$disconnect();
    } catch {}
  }
}

initDb();
