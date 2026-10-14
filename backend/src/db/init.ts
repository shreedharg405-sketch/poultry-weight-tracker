import { prisma } from './prisma.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { seedDatabase } from '../seed.js';

export const REQUIRED_TABLES = [
  'User',
  'Farm',
  'Shed',
  'Part',
  'Line',
  'ActivityLog',
  'Submission',
  'SubmissionShed',
  'SubmissionPart',
  'SubmissionLine',
  'BirdWeight',
];

export function isPostgresConfigured(): boolean {
  const dbUrl = process.env.DATABASE_URL;
  return Boolean(dbUrl && dbUrl.trim() && !dbUrl.startsWith('file:') && !dbUrl.startsWith('sqlite:'));
}

export function findSchemaPath(): string {
  const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const candidates = [
    path.resolve(process.cwd(), 'prisma/schema.prisma'),
    path.resolve(process.cwd(), 'backend/prisma/schema.prisma'),
    path.resolve(currentDir, '../../prisma/schema.prisma'),
    path.resolve(currentDir, '../../../prisma/schema.prisma'),
    path.resolve(currentDir, '../prisma/schema.prisma'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return path.resolve(process.cwd(), 'prisma/schema.prisma');
}

export interface TableStatus {
  name: string;
  rowCount: number;
}

export interface DbInspectionResult {
  connected: boolean;
  isPostgres: boolean;
  existingTables: TableStatus[];
  missingTables: string[];
  allRequiredExist: boolean;
  farmCount: number;
  userCount: number;
  submissionCount: number;
  birdWeightCount: number;
  activityLogCount: number;
  error?: string;
}

export async function inspectDatabase(): Promise<DbInspectionResult> {
  const result: DbInspectionResult = {
    connected: false,
    isPostgres: isPostgresConfigured(),
    existingTables: [],
    missingTables: [...REQUIRED_TABLES],
    allRequiredExist: false,
    farmCount: 0,
    userCount: 0,
    submissionCount: 0,
    birdWeightCount: 0,
    activityLogCount: 0,
  };

  if (!isPostgresConfigured()) {
    result.error = 'No PostgreSQL DATABASE_URL configured.';
    return result;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    result.connected = true;

    // Query tables in public schema
    const rawTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

    const existingNames = rawTables.map(t => t.table_name);
    const existingStatuses: TableStatus[] = [];

    for (const rawName of existingNames) {
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ count: string | number }>>(
          `SELECT count(*)::int as count FROM "public"."${rawName}"`
        );
        const count = rows[0]?.count !== undefined ? Number(rows[0].count) : 0;
        existingStatuses.push({ name: rawName, rowCount: count });
      } catch {
        existingStatuses.push({ name: rawName, rowCount: 0 });
      }
    }

    result.existingTables = existingStatuses;

    // Match required tables case-insensitively
    result.missingTables = REQUIRED_TABLES.filter(req => 
      !existingNames.some(ext => ext.toLowerCase() === req.toLowerCase())
    );
    result.allRequiredExist = result.missingTables.length === 0;

    // Retrieve specific entity counts if tables exist
    if (!result.missingTables.includes('Farm')) {
      try { result.farmCount = await prisma.farm.count(); } catch {}
    }
    if (!result.missingTables.includes('User')) {
      try { result.userCount = await prisma.user.count(); } catch {}
    }
    if (!result.missingTables.includes('Submission')) {
      try { result.submissionCount = await prisma.submission.count(); } catch {}
    }
    if (!result.missingTables.includes('BirdWeight')) {
      try { result.birdWeightCount = await prisma.birdWeight.count(); } catch {}
    }
    if (!result.missingTables.includes('ActivityLog')) {
      try { result.activityLogCount = await prisma.activityLog.count(); } catch {}
    }

    return result;
  } catch (err: any) {
    result.error = err?.message || 'Database inspection failed';
    return result;
  }
}

export async function syncDatabaseSchema(): Promise<{ success: boolean; message: string; inspection: DbInspectionResult }> {
  console.log('🔄 [DB-INIT] Checking PostgreSQL database schema and safety status...');

  if (!isPostgresConfigured()) {
    console.warn('⚠️ [DB-INIT] No PostgreSQL DATABASE_URL detected. Operating in local simulation / offline mode.');
    const inspection = await inspectDatabase();
    return {
      success: true,
      message: 'Local offline / simulation mode active.',
      inspection,
    };
  }

  try {
    let inspection = await inspectDatabase();

    if (!inspection.connected) {
      console.warn('⚠️ [DB-INIT] Could not connect to PostgreSQL:', inspection.error);
      return {
        success: false,
        message: `Database connection failed: ${inspection.error}`,
        inspection,
      };
    }

    console.log(`📊 [DB-INIT] Found ${inspection.existingTables.length} tables in PostgreSQL. Missing: ${inspection.missingTables.length}`);

    // If any required tables are missing, push the Prisma schema non-destructively
    if (inspection.missingTables.length > 0) {
      console.log(`📦 [DB-INIT] Missing required tables: ${inspection.missingTables.join(', ')}`);
      console.log('🚀 [DB-INIT] Executing non-destructive "prisma db push" to initialize schema...');

      const schemaPath = findSchemaPath();
      console.log(`📄 [DB-INIT] Using schema file at: ${schemaPath}`);

      // Run non-destructive prisma db push (never resets, never drops tables)
      const pushOutput = execSync(`npx prisma db push --schema="${schemaPath}" --skip-generate`, {
        stdio: 'pipe',
        env: process.env,
      }).toString();

      console.log('✅ [DB-INIT] Prisma schema push output:\n' + pushOutput);

      // Re-inspect database after push
      inspection = await inspectDatabase();
      if (inspection.missingTables.length > 0) {
        throw new Error(`Tables still missing after schema push: ${inspection.missingTables.join(', ')}`);
      }
      console.log('✅ [DB-INIT] All 11 required tables created successfully.');
    } else {
      console.log('✅ [DB-INIT] All 11 required models/tables exist in PostgreSQL.');
    }

    // Check if initial seeding is needed (safe: only if 0 records exist)
    if (inspection.farmCount === 0 || inspection.userCount === 0) {
      console.log('🌱 [DB-INIT] Empty database detected. Seeding initial baseline data...');
      await seedDatabase(inspection.farmCount, inspection.userCount);
      inspection = await inspectDatabase();
    } else {
      console.log(`🔒 [DB-INIT] Existing records preserved: ${inspection.farmCount} farms, ${inspection.userCount} users, ${inspection.submissionCount} submissions.`);
    }

    return {
      success: true,
      message: 'PostgreSQL schema synchronized and verified successfully.',
      inspection,
    };
  } catch (err: any) {
    console.error('❌ [DB-INIT] Failed to initialize PostgreSQL schema:', err?.message || err);
    const inspection = await inspectDatabase();
    return {
      success: false,
      message: err?.message || 'Database initialization error',
      inspection,
    };
  }
}

// Auto-run when executed directly via `node dist/db/init.js`
const isDirectRun = Boolean(
  process.argv[1] && (
    process.argv[1].endsWith('init.js') || 
    process.argv[1].endsWith('init.ts')
  )
);

if (isDirectRun) {
  syncDatabaseSchema()
    .then(res => {
      console.log('🏁 [DB-INIT] Initialization finished:', res.message);
      process.exit(res.success ? 0 : 1);
    })
    .catch(err => {
      console.error('💥 [DB-INIT] Fatal error:', err);
      process.exit(1);
    });
}
