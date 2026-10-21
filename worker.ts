/**
 * Cloudflare Worker Full-Stack Controller
 * Native Serverless API with Cloudflare D1 (DB) & Cloudflare R2 (STORAGE_BUCKET)
 */

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = Record<string, any>>(colName?: string): Promise<T | null>;
  run<T = Record<string, any>>(): Promise<{ success: boolean; results?: T[]; meta?: any }>;
  all<T = Record<string, any>>(): Promise<{ success: boolean; results: T[]; meta?: any }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<any[]>;
  exec(query: string): Promise<any>;
}

export interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
}

export interface R2Bucket {
  put(key: string, value: any, options?: any): Promise<any>;
  get(key: string): Promise<any>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: any): Promise<{ objects: R2Object[] }>;
}

export interface Env {
  DB?: D1Database;
  STORAGE_BUCKET?: R2Bucket;
  REPORT_BUCKET?: R2Bucket;
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
  ENVIRONMENT?: string;
}

// CORS Helper Headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message, success: false }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

// Ensure shed_week_status table exists in D1 database for Stage 2 shed-wise saves
async function ensureShedWeekStatusTable(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS shed_week_status (
        shed_id TEXT NOT NULL,
        farm_id TEXT NOT NULL,
        week TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SAVED',
        saved_by_user_id TEXT,
        saved_by_user_name TEXT,
        total_bird_count INTEGER DEFAULT 0,
        saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (shed_id, week)
      )
    `).run().catch(() => {});
    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_shed_week_status ON shed_week_status(farm_id, week)
    `).run().catch(() => {});
  } catch (err) {
    console.error('ensureShedWeekStatusTable error:', err);
  }
}

// Ensure batches table exists in D1 database for Farm -> Batch -> Week hierarchy
async function ensureBatchesTable(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        farm_id TEXT NOT NULL,
        batch_name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        start_week_number INTEGER NOT NULL DEFAULT 1,
        status TEXT CHECK(status IN ('ACTIVE', 'COMPLETED')) NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run().catch(() => {});
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_batches_farm ON batches(farm_id)`).run().catch(() => {});
  } catch (err) {
    console.error('ensureBatchesTable error:', err);
  }
}

// Ensure a farm has an active batch (auto-migrating existing records to Batch 1 if none exists)
async function ensureFarmActiveBatch(env: Env, farm: any): Promise<any> {
  if (!env.DB || !farm) return null;
  await ensureBatchesTable(env);
  let activeBatch = await env.DB.prepare(
    'SELECT * FROM batches WHERE farm_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(farm.id, 'ACTIVE').first() as any;

  if (!activeBatch) {
    const existing = await env.DB.prepare(
      'SELECT * FROM batches WHERE farm_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(farm.id).first() as any;

    if (!existing) {
      const batchId = `batch-${farm.id}-1`;
      const batchName = 'Batch 1';
      const startDate = farm.flock_date || new Date().toISOString().split('T')[0];
      const startWeekNum = parseInt(String(farm.age_week || 'W1').replace(/\D/g, '') || '1', 10);

      await env.DB.prepare(`
        INSERT INTO batches (id, farm_id, batch_name, start_date, start_week_number, status)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE')
      `).bind(batchId, farm.id, batchName, startDate, startWeekNum).run().catch(() => {});

      // Link any legacy unassigned records to Batch 1
      await env.DB.prepare(
        'UPDATE bird_weights SET batch_id = ? WHERE batch_id IS NULL'
      ).bind(batchId).run().catch(() => {});
      await env.DB.prepare(
        'UPDATE shed_week_status SET batch_id = ? WHERE batch_id IS NULL AND farm_id = ?'
      ).bind(batchId, farm.id).run().catch(() => {});
      await env.DB.prepare(
        'UPDATE submissions SET batch_id = ?, batch_name = ? WHERE batch_id IS NULL AND farm_id = ?'
      ).bind(batchId, batchName, farm.id).run().catch(() => {});

      activeBatch = {
        id: batchId,
        farm_id: farm.id,
        farmId: farm.id,
        batch_name: batchName,
        batchName: batchName,
        start_date: startDate,
        startDate: startDate,
        start_week_number: startWeekNum,
        startWeekNumber: startWeekNum,
        status: 'ACTIVE',
      };
    } else {
      activeBatch = existing;
    }
  }

  return {
    id: activeBatch.id,
    farmId: activeBatch.farm_id || farm.id,
    batchName: activeBatch.batch_name || activeBatch.batchName || 'Batch 1',
    startDate: activeBatch.start_date || activeBatch.startDate || farm.flock_date,
    startWeekNumber: activeBatch.start_week_number || activeBatch.startWeekNumber || 1,
    status: activeBatch.status,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // 1. Handle CORS Preflight Requests
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. Handle API Routes under /api/
    if (url.pathname.startsWith('/api')) {
      try {
        const path = url.pathname.replace(/^\/api/, '') || '/';

        // -------------------------------------------------------------
        // A. HIERARCHY ENDPOINTS: GET /api/hierarchy, POST /api/hierarchy
        // -------------------------------------------------------------
        if (path === '/hierarchy' || path === '/hierarchy/') {
          if (method === 'GET') {
            const farmId = url.searchParams.get('farmId');
            if (!env.DB) {
              return jsonResponse({
                farms: [],
                message: 'D1 binding not initialized yet in local test mode.',
              });
            }

            const farmQuery = farmId
              ? await env.DB.prepare('SELECT * FROM farms WHERE id = ?').bind(farmId).all()
              : await env.DB.prepare('SELECT * FROM farms WHERE is_archived = 0 ORDER BY created_at DESC').all();

            const farms = farmQuery.results || [];
            const fullHierarchy: any[] = [];

            for (const f of farms) {
              const shedsRes = await env.DB.prepare('SELECT * FROM sheds WHERE farm_id = ?').bind(f.id).all();
              const sheds = shedsRes.results || [];
              const shedList: any[] = [];

              for (const s of sheds) {
                const partsRes = await env.DB.prepare('SELECT * FROM parts WHERE shed_id = ?').bind(s.id).all();
                const parts = partsRes.results || [];
                const partList: any[] = [];

                for (const p of parts) {
                  const linesRes = await env.DB.prepare(
                    'SELECT * FROM lines WHERE part_id = ? ORDER BY line_number ASC'
                  ).bind(p.id).all();
                  const lines = linesRes.results || [];
                  const lineList: any[] = [];

                  for (const l of lines) {
                    const weightsRes = await env.DB.prepare(
                      'SELECT weight_grams FROM bird_weights WHERE line_id = ? ORDER BY entry_index ASC'
                    ).bind(l.id).all();
                    const weights = (weightsRes.results || []).map((w: any) => w.weight_grams);

                    lineList.push({
                      id: l.id,
                      name: l.name,
                      lineNumber: l.line_number,
                      gender: l.gender, // 'MALE' | 'FEMALE'
                      stdWeight: l.std_weight_grams,
                      targetBirdCount: l.target_bird_count,
                      weights,
                    });
                  }

                  partList.push({
                    id: p.id,
                    name: p.name,
                    lines: lineList,
                  });
                }

                shedList.push({
                  id: s.id,
                  name: s.name,
                  targetBirdCount: s.target_bird_count,
                  lockedByUserId: s.locked_by_user_id || null,
                  lockedByUserName: s.locked_by_user_name || null,
                  lockedAt: s.locked_at || null,
                  lastHeartbeatAt: s.last_heartbeat_at || null,
                  recordedByUserId: s.recorded_by_user_id || null,
                  recordedByUserName: s.recorded_by_user_name || null,
                  parts: partList,
                });
              }

              fullHierarchy.push({
                ...f,
                sheds: shedList,
              });
            }

            return jsonResponse({ success: true, farms: fullHierarchy });
          }

          if (method === 'POST') {
            const body = await request.json().catch(() => ({})) as any;
            if (!env.DB) return jsonResponse({ success: true, message: 'D1 not bound' });

            const farmId = body.farmId || `farm-${Date.now()}`;
            const farmName = body.name || 'New Farm';
            const season = body.season || 'Summer';
            const ageWeek = body.ageWeek || 'W1';

            await env.DB.prepare(
              'INSERT INTO farms (id, name, season, age_week, flock_date) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=CURRENT_TIMESTAMP'
            ).bind(farmId, farmName, season, ageWeek).run();

            return jsonResponse({ success: true, farmId });
          }
        }

        // -------------------------------------------------------------
        // B. LINE GENDER ENDPOINT: PATCH /api/lines/:id/gender
        // -------------------------------------------------------------
        const lineGenderMatch = path.match(/^\/lines\/([^/]+)\/gender$/);
        if (lineGenderMatch && method === 'PATCH') {
          const lineId = decodeURIComponent(lineGenderMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const gender = (body.gender || '').toUpperCase();

          if (gender !== 'MALE' && gender !== 'FEMALE') {
            return errorResponse('Invalid gender. Must be MALE or FEMALE', 400);
          }

          if (!env.DB) {
            return jsonResponse({ success: true, lineId, gender, note: 'Simulated D1 mode' });
          }

          // Fetch flock age/week to look up new STD
          const lineInfo = await env.DB.prepare(`
            SELECT l.id, l.name, l.part_id, f.flock_age_days, f.age_week
            FROM lines l
            JOIN parts p ON l.part_id = p.id
            JOIN sheds s ON p.shed_id = s.id
            JOIN farms f ON s.farm_id = f.id
            WHERE l.id = ?
          `).bind(lineId).first() as any;

          let stdWeight = gender === 'MALE' ? 150 : 140;
          if (lineInfo) {
            const weekNum = parseInt(String(lineInfo.age_week || 'W1').replace(/\D/g, '') || '1', 10);
            const stdLookup = await env.DB.prepare(
              'SELECT std_weight_grams FROM standard_weights WHERE age_week = ? AND gender = ?'
            ).bind(weekNum, gender).first() as any;
            if (stdLookup && stdLookup.std_weight_grams) {
              stdWeight = stdLookup.std_weight_grams;
            }
          }

          await env.DB.prepare(
            'UPDATE lines SET gender = ?, std_weight_grams = ? WHERE id = ?'
          ).bind(gender, stdWeight, lineId).run();

          return jsonResponse({
            success: true,
            lineId,
            gender,
            stdWeightGrams: stdWeight,
            message: `Line gender updated to ${gender} with STD ${stdWeight}g`,
          });
        }

        // -------------------------------------------------------------
        // C. WEIGHTS ENDPOINTS: POST /api/weights, DELETE /api/weights
        // -------------------------------------------------------------
        if (path === '/weights' || path === '/weights/') {
          if (method === 'POST') {
            const body = await request.json().catch(() => ({})) as any;
            const { lineId, weight, entryIndex, recordedBy, week } = body;

            if (!lineId || weight === undefined || weight === null) {
              return errorResponse('Missing required fields: lineId and weight', 400);
            }

            const weightGrams = Number(weight);
            if (isNaN(weightGrams) || weightGrams <= 0) {
              return errorResponse('Weight must be a positive number', 400);
            }

            if (!env.DB) {
              return jsonResponse({ success: true, id: `w-${Date.now()}`, weightGrams });
            }

            // Get current line STD
            const line = await env.DB.prepare('SELECT std_weight_grams, gender FROM lines WHERE id = ?').bind(lineId).first() as any;
            const stdWeightAtEntry = line?.std_weight_grams || 140;

            const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM bird_weights WHERE line_id = ?').bind(lineId).first() as any;
            const finalIndex = entryIndex !== undefined ? entryIndex : (countRes?.count || 0) + 1;
            const weightId = `w-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

            await env.DB.prepare(
              'INSERT INTO bird_weights (id, line_id, entry_index, weight_grams, std_weight_at_entry, recorded_by, week) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).bind(weightId, lineId, finalIndex, weightGrams, stdWeightAtEntry, recordedBy || 'Operator', week || 'W1').run();

            return jsonResponse({
              success: true,
              id: weightId,
              lineId,
              entryIndex: finalIndex,
              weightGrams,
              stdWeightAtEntry,
            });
          }

          if (method === 'DELETE') {
            const body = await request.json().catch(() => ({})) as any;
            const { id, lineId, index, clearAll } = body;

            if (!env.DB) return jsonResponse({ success: true });

            if (clearAll && lineId) {
              await env.DB.prepare('DELETE FROM bird_weights WHERE line_id = ?').bind(lineId).run();
              return jsonResponse({ success: true, message: `Cleared all weights in line ${lineId}` });
            }

            if (id) {
              await env.DB.prepare('DELETE FROM bird_weights WHERE id = ?').bind(id).run();
              return jsonResponse({ success: true, message: `Deleted weight ${id}` });
            }

            if (lineId && index !== undefined) {
              // Delete by line and order index
              const target = await env.DB.prepare(
                'SELECT id FROM bird_weights WHERE line_id = ? ORDER BY entry_index ASC LIMIT 1 OFFSET ?'
              ).bind(lineId, index).first() as any;

              if (target?.id) {
                await env.DB.prepare('DELETE FROM bird_weights WHERE id = ?').bind(target.id).run();
              }
              return jsonResponse({ success: true, message: `Deleted weight at index ${index}` });
            }

            return errorResponse('Specify weight id, clearAll, or lineId and index', 400);
          }
        }

        // Sub-routes for weights on lines:
        // POST /api/lines/:id/weight
        // DELETE /api/lines/:id/weight/:index
        // POST /api/lines/:id/clear
        const lineWeightMatch = path.match(/^\/lines\/([^/]+)\/weight$/);
        if (lineWeightMatch && method === 'POST') {
          const lineId = decodeURIComponent(lineWeightMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const weightGrams = Number(body.weight);

          if (!env.DB) return jsonResponse({ success: true, weight: weightGrams });

          const line = await env.DB.prepare('SELECT std_weight_grams FROM lines WHERE id = ?').bind(lineId).first() as any;
          const stdWeightAtEntry = line?.std_weight_grams || 140;
          const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM bird_weights WHERE line_id = ?').bind(lineId).first() as any;
          const nextIndex = (countRes?.count || 0) + 1;
          const weightId = `w-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

          await env.DB.prepare(
            'INSERT INTO bird_weights (id, line_id, entry_index, weight_grams, std_weight_at_entry, recorded_by, week) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(weightId, lineId, nextIndex, weightGrams, stdWeightAtEntry, body.userName || 'Operator', body.week || 'W1').run();

          return jsonResponse({ success: true, id: weightId, weight: weightGrams });
        }

        const lineDeleteWeightMatch = path.match(/^\/lines\/([^/]+)\/weight\/(\d+)$/);
        if (lineDeleteWeightMatch && method === 'DELETE') {
          const lineId = decodeURIComponent(lineDeleteWeightMatch[1]);
          const index = parseInt(lineDeleteWeightMatch[2], 10);

          if (!env.DB) return jsonResponse({ success: true });

          const target = await env.DB.prepare(
            'SELECT id FROM bird_weights WHERE line_id = ? ORDER BY entry_index ASC LIMIT 1 OFFSET ?'
          ).bind(lineId, index).first() as any;

          if (target?.id) {
            await env.DB.prepare('DELETE FROM bird_weights WHERE id = ?').bind(target.id).run();
          }

          return jsonResponse({ success: true });
        }

        const lineClearMatch = path.match(/^\/lines\/([^/]+)\/clear$/);
        if (lineClearMatch && method === 'POST') {
          const lineId = decodeURIComponent(lineClearMatch[1]);
          if (env.DB) {
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id = ?').bind(lineId).run();
          }
          return jsonResponse({ success: true, message: `Weights cleared for line ${lineId}` });
        }

        // -------------------------------------------------------------
        // D. ADMIN ANALYTICS ENDPOINT: GET /api/admin/analytics
        // Computes AVG WT, STD, Uniformity %, CV % dynamically per Line Gender
        // -------------------------------------------------------------
        if ((path === '/admin/analytics' || path === '/admin/analytics/') && method === 'GET') {
          const farmId = url.searchParams.get('farmId');
          if (!env.DB) {
            return jsonResponse({
              analytics: {
                totalBirds: 0,
                femaleAvg: 0,
                maleAvg: 0,
                femaleUniformity: 0,
                maleUniformity: 0,
                linesBreakdown: [],
              },
            });
          }

          const linesQuery = farmId
            ? await env.DB.prepare(`
                SELECT l.id, l.name as line_name, l.gender, l.std_weight_grams,
                       s.id as shed_id, s.name as shed_name,
                       p.id as part_id, p.name as part_name
                FROM lines l
                JOIN parts p ON l.part_id = p.id
                JOIN sheds s ON p.shed_id = s.id
                WHERE s.farm_id = ?
                ORDER BY s.name, p.name, l.line_number
              `).bind(farmId).all()
            : await env.DB.prepare(`
                SELECT l.id, l.name as line_name, l.gender, l.std_weight_grams,
                       s.id as shed_id, s.name as shed_name,
                       p.id as part_id, p.name as part_name
                FROM lines l
                JOIN parts p ON l.part_id = p.id
                JOIN sheds s ON p.shed_id = s.id
                ORDER BY s.name, p.name, l.line_number
              `).all();

          const allLines = linesQuery.results || [];
          const linesBreakdown: any[] = [];

          let allFemaleWeights: number[] = [];
          let allMaleWeights: number[] = [];

          for (const l of allLines) {
            const weightsRes = await env.DB.prepare(
              'SELECT weight_grams FROM bird_weights WHERE line_id = ?'
            ).bind(l.id).all();
            const weights = (weightsRes.results || []).map((w: any) => Number(w.weight_grams));

            const count = weights.length;
            const sum = weights.reduce((a: number, b: number) => a + b, 0);
            const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
            const std = l.std_weight_grams || (l.gender === 'MALE' ? 150 : 140);

            // Uniformity: percentage within std ± 10%
            const lowerBand = std * 0.9;
            const upperBand = std * 1.1;
            const inRangeCount = count > 0 ? weights.filter((w: number) => w >= lowerBand && w <= upperBand).length : 0;
            const uniformityPct = count > 0 ? Math.round((inRangeCount / count) * 1000) / 10 : 0;

            // CV% (Coefficient of variation: Standard Deviation / Mean * 100)
            let cv = 0;
            if (count > 1 && avg > 0) {
              const variance = weights.reduce((acc: number, val: number) => acc + Math.pow(val - avg, 2), 0) / (count - 1);
              const stdDev = Math.sqrt(variance);
              cv = Math.round((stdDev / avg) * 10000) / 100;
            }

            if (l.gender === 'FEMALE') {
              allFemaleWeights.push(...weights);
            } else {
              allMaleWeights.push(...weights);
            }

            linesBreakdown.push({
              lineId: l.id,
              lineName: l.line_name,
              shedName: l.shed_name,
              partName: l.part_name,
              gender: l.gender,
              stdWeight: std,
              birdCount: count,
              averageWeight: avg,
              uniformityPercent: uniformityPct,
              cvPercent: cv,
            });
          }

          const calcGroupStats = (weightsList: number[]) => {
            const count = weightsList.length;
            if (count === 0) return { count: 0, avg: 0, uniformity: 0 };
            const avg = Math.round((weightsList.reduce((a, b) => a + b, 0) / count) * 10) / 10;
            const inRange = weightsList.filter(w => w >= avg * 0.9 && w <= avg * 1.1).length;
            return {
              count,
              avg,
              uniformity: Math.round((inRange / count) * 1000) / 10,
            };
          };

          return jsonResponse({
            success: true,
            analytics: {
              totalBirds: allFemaleWeights.length + allMaleWeights.length,
              female: calcGroupStats(allFemaleWeights),
              male: calcGroupStats(allMaleWeights),
              linesBreakdown,
            },
          });
        }

        // -------------------------------------------------------------
        // E. FARMS REST ENDPOINTS: GET /api/farms, POST /api/farms
        // -------------------------------------------------------------
        if (path === '/farms' || path === '/farms/') {
          if (method === 'GET') {
            if (!env.DB) {
              return jsonResponse([]);
            }
            await ensureBatchesTable(env);
            const includeArchived = url.searchParams.get('includeArchived') === 'true';
            const farmsRes = includeArchived
              ? await env.DB.prepare('SELECT * FROM farms ORDER BY created_at DESC').all()
              : await env.DB.prepare('SELECT * FROM farms WHERE is_archived = 0 ORDER BY created_at DESC').all();

            const farms = farmsRes.results || [];
            const summaries: any[] = [];

            for (const f of farms) {
              const activeBatch = await ensureFarmActiveBatch(env, f);
              const shedCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM sheds WHERE farm_id = ?').bind(f.id).first() as any;
              const subCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM submissions WHERE farm_id = ?').bind(f.id).first() as any;

              summaries.push({
                id: f.id,
                name: f.name,
                location: f.location,
                flockDate: activeBatch?.startDate || f.flock_date || f.created_at,
                ageWeek: f.age_week || 'W1',
                season: f.season || 'Summer',
                updatedAt: f.updated_at || f.created_at,
                isArchived: Boolean(f.is_archived),
                activeBatch,
                startDate: activeBatch?.startDate || f.flock_date,
                startWeekNumber: activeBatch?.startWeekNumber || 1,
                _count: {
                  sheds: shedCountRes?.count || 0,
                  submissions: subCountRes?.count || 0,
                },
              });
            }

            return jsonResponse(summaries);
          }

          if (method === 'POST') {
            const body = await request.json().catch(() => ({})) as any;
            const farmId = `farm-${Date.now()}`;
            const farmName = body.name || 'New Farm';
            const season = body.season || 'Summer';
            const ageWeek = body.ageWeek || 'W1';
            const flockDate = body.flockDate || new Date().toISOString().split('T')[0];
            const shedCount = Math.min(Math.max(Number(body.shedCount) || 10, 1), 40);

            if (env.DB) {
              await ensureBatchesTable(env);
              await env.DB.prepare(
                'INSERT INTO farms (id, name, season, age_week, flock_date) VALUES (?, ?, ?, ?, ?)'
              ).bind(farmId, farmName, season, ageWeek, flockDate).run();

              // Automatically initialize default Batch 1 for the new farm
              const batchId = `batch-${farmId}-1`;
              const startWeekNum = parseInt(String(ageWeek || 'W1').replace(/\D/g, '') || '1', 10);
              await env.DB.prepare(`
                INSERT INTO batches (id, farm_id, batch_name, start_date, start_week_number, status)
                VALUES (?, ?, 'Batch 1', ?, ?, 'ACTIVE')
              `).bind(batchId, farmId, flockDate, startWeekNum).run().catch(() => {});

              // Pre-create sheds, parts, and lines with Line-level Gender
              for (let sIdx = 1; sIdx <= shedCount; sIdx++) {
                const shedId = `shed-${farmId}-${sIdx}`;
                await env.DB.prepare(
                  'INSERT INTO sheds (id, farm_id, name) VALUES (?, ?, ?)'
                ).bind(shedId, farmId, `Shed ${sIdx}`).run();

                // 2 Parts per shed
                for (let pIdx = 1; pIdx <= 2; pIdx++) {
                  const partId = `part-${shedId}-${pIdx}`;
                  const partName = pIdx === 1 ? 'Part 1' : 'Part 2';
                  await env.DB.prepare(
                    'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
                  ).bind(partId, shedId, partName).run();

                  // 5 Lines per part
                  for (let lIdx = 1; lIdx <= 5; lIdx++) {
                    const lineId = `line-${partId}-${lIdx}`;
                    // Default to FEMALE for main grower lines, MALE for line 5
                    const gender = (sIdx === shedCount || lIdx === 5) ? 'MALE' : 'FEMALE';
                    const std = gender === 'MALE' ? 150 : 140;

                    await env.DB.prepare(
                      'INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams) VALUES (?, ?, ?, ?, ?, ?)'
                    ).bind(lineId, partId, lIdx, `Line ${lIdx}`, gender, std).run();
                  }
                }
              }
            }

            return jsonResponse({
              id: farmId,
              name: farmName,
              season,
              ageWeek,
              flockDate,
              sheds: [],
            }, 201);
          }
        }

        // -------------------------------------------------------------
        // E2. BATCHES REST ENDPOINTS: GET & POST /api/farms/:id/batches
        // -------------------------------------------------------------
        const farmBatchesMatch = path.match(/^\/farms\/([^/]+)\/batches$/);
        if (farmBatchesMatch) {
          const farmId = decodeURIComponent(farmBatchesMatch[1]);
          if (method === 'GET') {
            if (!env.DB) return jsonResponse({ success: true, batches: [] });
            await ensureBatchesTable(env);
            const farm = await env.DB.prepare('SELECT * FROM farms WHERE id = ?').bind(farmId).first() as any;
            if (!farm) return errorResponse('Farm not found', 404);

            await ensureFarmActiveBatch(env, farm);
            const batchesRes = await env.DB.prepare(
              'SELECT * FROM batches WHERE farm_id = ? ORDER BY created_at DESC'
            ).bind(farmId).all();

            const batches = (batchesRes.results || []).map((b: any) => ({
              id: b.id,
              farmId: b.farm_id,
              batchName: b.batch_name,
              startDate: b.start_date,
              startWeekNumber: b.start_week_number,
              status: b.status,
              createdAt: b.created_at,
              updatedAt: b.updated_at,
            }));

            return jsonResponse({ success: true, batches });
          }

          if (method === 'POST') {
            if (!env.DB) return jsonResponse({ success: true, message: 'D1 not bound' });
            await ensureBatchesTable(env);
            const farm = await env.DB.prepare('SELECT * FROM farms WHERE id = ?').bind(farmId).first() as any;
            if (!farm) return errorResponse('Farm not found', 404);

            const body = await request.json().catch(() => ({})) as any;

            // 1. Mark existing batches as COMPLETED (read-only)
            await env.DB.prepare(
              'UPDATE batches SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE farm_id = ?'
            ).bind('COMPLETED', farmId).run();

            // 2. Determine new batch name
            const countRes = await env.DB.prepare(
              'SELECT COUNT(*) as count FROM batches WHERE farm_id = ?'
            ).bind(farmId).first() as any;
            const count = (countRes?.count || 0) + 1;
            const batchName = (body.batchName || `Batch ${count}`).trim();
            const startDate = body.startDate || new Date().toISOString().split('T')[0];
            const startWeekNumber = Number(body.startWeekNumber) || 1;
            const batchId = `batch-${farmId}-${Date.now()}`;

            // 3. Create new ACTIVE batch
            await env.DB.prepare(`
              INSERT INTO batches (id, farm_id, batch_name, start_date, start_week_number, status)
              VALUES (?, ?, ?, ?, ?, 'ACTIVE')
            `).bind(batchId, farmId, batchName, startDate, startWeekNumber).run();

            // 4. Release any active locks so new batch starts fresh
            await env.DB.prepare(`
              UPDATE sheds SET
                locked_by_user_id = NULL,
                locked_by_user_name = NULL,
                locked_at = NULL,
                last_heartbeat_at = NULL
              WHERE farm_id = ?
            `).bind(farmId).run().catch(() => {});

            const newBatch = {
              id: batchId,
              farmId,
              batchName,
              startDate,
              startWeekNumber,
              status: 'ACTIVE',
            };

            return jsonResponse({
              success: true,
              batch: newBatch,
              message: `Started ${batchName} successfully for farm ${farm.name}.`,
            }, 201);
          }
        }

        // GET /api/farms/:id
        const singleFarmMatch = path.match(/^\/farms\/([^/]+)$/);
        if (singleFarmMatch) {
          const farmId = decodeURIComponent(singleFarmMatch[1]);
          if (method === 'GET') {
            if (!env.DB) {
              return jsonResponse({ id: farmId, name: 'Active Farm', sheds: [] });
            }

            await ensureShedWeekStatusTable(env);
            await ensureBatchesTable(env);

            const farm = await env.DB.prepare('SELECT * FROM farms WHERE id = ?').bind(farmId).first() as any;
            if (!farm) return errorResponse('Farm not found', 404);

            const activeBatch = await ensureFarmActiveBatch(env, farm);
            const requestedBatchId = url.searchParams.get('batchId');
            const targetBatchId = requestedBatchId || activeBatch?.id;

            // Fetch all batches for this farm
            const allBatchesRes = await env.DB.prepare(
              'SELECT * FROM batches WHERE farm_id = ? ORDER BY created_at DESC'
            ).bind(farmId).all().catch(() => ({ results: [] }));
            const batchesList = (allBatchesRes.results || []).map((b: any) => ({
              id: b.id,
              farmId: b.farm_id,
              batchName: b.batch_name,
              startDate: b.start_date,
              startWeekNumber: b.start_week_number,
              status: b.status,
            }));

            // Check if selected batch is the initial/first batch for legacy backward compatibility
            const firstBatch = batchesList.length > 0 ? batchesList[batchesList.length - 1] : null;
            const isInitialBatch = Boolean(firstBatch && firstBatch.id === targetBatchId);

            const targetWeek = (url.searchParams.get('week') || farm.age_week || 'W18').toUpperCase();

            // Check if submission exists for this specific week and batch
            const subForWeek = isInitialBatch
              ? await env.DB.prepare(
                  'SELECT * FROM submissions WHERE farm_id = ? AND UPPER(flock_age) = ? AND (batch_id = ? OR batch_id IS NULL) ORDER BY created_at DESC LIMIT 1'
                ).bind(farmId, targetWeek, targetBatchId).first() as any
              : await env.DB.prepare(
                  'SELECT * FROM submissions WHERE farm_id = ? AND UPPER(flock_age) = ? AND batch_id = ? ORDER BY created_at DESC LIMIT 1'
                ).bind(farmId, targetWeek, targetBatchId).first() as any;

            // Fetch shed saves for this week and batch from shed_week_status
            const shedWeekStatuses = isInitialBatch
              ? await env.DB.prepare(
                  'SELECT * FROM shed_week_status WHERE farm_id = ? AND UPPER(week) = ? AND (batch_id = ? OR batch_id IS NULL)'
                ).bind(farmId, targetWeek, targetBatchId).all().catch(() => ({ results: [] }))
              : await env.DB.prepare(
                  'SELECT * FROM shed_week_status WHERE farm_id = ? AND UPPER(week) = ? AND batch_id = ?'
                ).bind(farmId, targetWeek, targetBatchId).all().catch(() => ({ results: [] }));
            const swsMap = new Map((shedWeekStatuses.results || []).map((s: any) => [s.shed_id, s]));

            const shedsRes = await env.DB.prepare('SELECT * FROM sheds WHERE farm_id = ?').bind(farmId).all();
            const sheds: any[] = [];
            let totalFarmBirds = 0;
            let savedShedsCount = 0;

            for (const s of shedsRes.results || []) {
              const partsRes = await env.DB.prepare('SELECT * FROM parts WHERE shed_id = ?').bind(s.id).all();
              const parts: any[] = [];
              let shedBirdCount = 0;

              for (const p of partsRes.results || []) {
                const linesRes = await env.DB.prepare('SELECT * FROM lines WHERE part_id = ? ORDER BY line_number ASC').bind(p.id).all();
                const lines: any[] = [];

                for (const l of linesRes.results || []) {
                  // Strictly filter weights by line_id, targetWeek AND batch
                  const weightsRes = isInitialBatch
                    ? await env.DB.prepare(
                        'SELECT weight_grams FROM bird_weights WHERE line_id = ? AND UPPER(week) = ? AND (batch_id = ? OR batch_id IS NULL) ORDER BY entry_index ASC'
                      ).bind(l.id, targetWeek, targetBatchId).all()
                    : await env.DB.prepare(
                        'SELECT weight_grams FROM bird_weights WHERE line_id = ? AND UPPER(week) = ? AND batch_id = ? ORDER BY entry_index ASC'
                      ).bind(l.id, targetWeek, targetBatchId).all();

                  const weights = (weightsRes.results || []).map((w: any) => w.weight_grams);
                  shedBirdCount += weights.length;

                  lines.push({
                    id: l.id,
                    name: l.name,
                    gender: l.gender,
                    weights,
                  });
                }

                parts.push({
                  id: p.id,
                  name: p.name,
                  lines,
                });
              }

              totalFarmBirds += shedBirdCount;
              const sws: any = swsMap.get(s.id);
              const isSaved = sws?.status === 'SAVED';
              if (isSaved) savedShedsCount++;

              sheds.push({
                id: s.id,
                name: s.name,
                lockedByUserId: s.locked_by_user_id || null,
                lockedByUserName: s.locked_by_user_name || null,
                lockedAt: s.locked_at || null,
                lastHeartbeatAt: s.last_heartbeat_at || null,
                recordedByUserId: s.recorded_by_user_id || null,
                recordedByUserName: s.recorded_by_user_name || null,
                // Stage 2: Team Visibility attributes
                savedStatus: isSaved ? 'SAVED' : (shedBirdCount > 0 ? 'DRAFT' : null),
                savedByUserId: sws?.saved_by_user_id || s.recorded_by_user_id || null,
                savedByUserName: sws?.saved_by_user_name || s.recorded_by_user_name || null,
                totalBirdCount: sws?.total_bird_count ?? shedBirdCount,
                savedAt: sws?.saved_at || null,
                parts,
              });
            }

            const totalShedsCount = sheds.length;
            const allShedsSaved = totalShedsCount > 0 && savedShedsCount >= totalShedsCount;
            const selectedBatch = batchesList.find(b => b.id === targetBatchId) || activeBatch;

            return jsonResponse({
              ...farm,
              ageWeek: targetWeek,
              activeBatch,
              batches: batchesList,
              currentBatch: selectedBatch,
              startDate: selectedBatch?.startDate || farm.flock_date,
              startWeekNumber: selectedBatch?.startWeekNumber || 1,
              status: subForWeek ? 'COMPLETED' : 'DRAFT',
              audit: subForWeek ? {
                status: 'COMPLETED',
                lastSubmittedAt: subForWeek.created_at,
                lastSubmittedBy: subForWeek.submitted_by,
                lastSubmittedRole: subForWeek.submitted_role,
                submittedBy: subForWeek.submitted_by,
                submittedRole: subForWeek.submitted_role,
                totalBirdsSubmitted: subForWeek.total_birds,
                batchId: subForWeek.batch_id,
                batchName: subForWeek.batch_name,
              } : null,
              farmProgress: {
                totalShedsCount,
                savedShedsCount,
                totalFarmBirds,
                allShedsSaved,
                progressPercent: totalShedsCount > 0 ? Math.round((savedShedsCount / totalShedsCount) * 100) : 0,
              },
              allShedsSaved,
              sheds,
            });
          }

          if (method === 'DELETE') {
            if (env.DB) {
              await env.DB.prepare('UPDATE farms SET is_archived = 1 WHERE id = ?').bind(farmId).run();
            }
            return jsonResponse({ success: true, message: 'Farm archived' });
          }
        }

        // PUT /api/farms/:id/details
        const farmDetailsMatch = path.match(/^\/farms\/([^/]+)\/details$/);
        if (farmDetailsMatch && method === 'PUT') {
          const farmId = decodeURIComponent(farmDetailsMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          if (env.DB && body.name) {
            await env.DB.prepare('UPDATE farms SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(body.name, farmId).run();
          }
          return jsonResponse({ success: true, message: 'Farm details updated' });
        }

        // PUT /api/farms/:id/sync
        const farmSyncMatch = path.match(/^\/farms\/([^/]+)\/sync$/);
        if (farmSyncMatch && method === 'PUT') {
          const farmId = decodeURIComponent(farmSyncMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          if (env.DB && body.sheds && Array.isArray(body.sheds)) {
            // Save state / sync lines
            for (const s of body.sheds) {
              for (const p of s.parts || []) {
                for (const l of p.lines || []) {
                  if (l.gender) {
                    await env.DB.prepare('UPDATE lines SET gender = ? WHERE id = ?').bind(l.gender.toUpperCase(), l.id).run().catch(() => {});
                  }
                }
              }
            }
          }
          return jsonResponse({ success: true, farmId });
        }

        // -------------------------------------------------------------
        // SHED CONCURRENCY LOCKING & OPERATOR ATTRIBUTION
        // -------------------------------------------------------------
        if (path === '/sheds/locks' || path.match(/^\/farms\/[^/]+\/shed-locks$/)) {
          if (method === 'GET') {
            const farmIdParam = url.searchParams.get('farmId');
            const targetWeek = (url.searchParams.get('week') || 'W18').toUpperCase();
            const locks: Record<string, any> = {};
            let totalShedsCount = 0;
            let savedShedsCount = 0;
            let totalFarmBirdsCount = 0;

            if (env.DB) {
              await ensureShedWeekStatusTable(env);

              const allShedsRes = farmIdParam
                ? await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, recorded_by_user_id, recorded_by_user_name FROM sheds WHERE farm_id = ?').bind(farmIdParam).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, recorded_by_user_id, recorded_by_user_name FROM sheds').all().catch(() => ({ results: [] }));

              // Query shed saves for this week
              const swsRes = farmIdParam
                ? await env.DB.prepare('SELECT * FROM shed_week_status WHERE farm_id = ? AND UPPER(week) = ?').bind(farmIdParam, targetWeek).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT * FROM shed_week_status WHERE UPPER(week) = ?').bind(targetWeek).all().catch(() => ({ results: [] }));
              
              const swsMap = new Map((swsRes.results || []).map((row: any) => [row.shed_id, row]));
              const shedsList = allShedsRes.results || [];
              totalShedsCount = shedsList.length;

              for (const s of shedsList) {
                const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
                const isLocked = Boolean(s.locked_by_user_id && last && (Date.now() - last <= 120_000));
                const sws: any = swsMap.get(s.id);
                const isSaved = sws?.status === 'SAVED';
                if (isSaved) savedShedsCount++;

                const birdsInShed = sws?.total_bird_count || 0;
                totalFarmBirdsCount += birdsInShed;

                locks[s.id] = {
                  shedId: s.id,
                  shedName: s.name,
                  farmId: s.farm_id,
                  locked: isLocked,
                  lockedByUserId: isLocked ? s.locked_by_user_id : null,
                  lockedByUserName: isLocked ? s.locked_by_user_name : null,
                  lockedAt: isLocked ? s.locked_at : null,
                  lastHeartbeatAt: isLocked ? s.last_heartbeat_at : null,
                  recordedByUserId: s.recorded_by_user_id || null,
                  recordedByUserName: s.recorded_by_user_name || null,
                  // Stage 2: Team Visibility attributes
                  savedStatus: isSaved ? 'SAVED' : null,
                  savedByUserId: sws?.saved_by_user_id || s.recorded_by_user_id || null,
                  savedByUserName: sws?.saved_by_user_name || s.recorded_by_user_name || null,
                  totalBirdCount: birdsInShed,
                  savedAt: sws?.saved_at || null,
                };
              }
            }

            const allShedsSaved = totalShedsCount > 0 && savedShedsCount >= totalShedsCount;
            return jsonResponse({
              locks,
              farmProgress: {
                totalShedsCount,
                savedShedsCount,
                totalFarmBirdsCount,
                allShedsSaved,
                progressPercent: totalShedsCount > 0 ? Math.round((savedShedsCount / totalShedsCount) * 100) : 0,
              },
              allShedsSaved,
            });
          }
        }

        // POST /api/sheds/:shedId/enter
        const shedEnterMatch = path.match(/^\/sheds\/([^/]+)\/enter$/);
        if (shedEnterMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedEnterMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const userId = body.userId || body.lockedByUserId || request.headers.get('x-user-id');
          const userName = body.userName || body.lockedByUserName || request.headers.get('x-user-username') || 'Incharge';

          if (!userId) {
            return errorResponse('Authentication required. Please log in.', 401);
          }

          if (env.DB) {
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(shed.locked_by_user_id && last && (Date.now() - last <= 120_000));

            if (shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name || 'Another Incharge',
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
              });
            }

            const nowIso = new Date().toISOString();
            await env.DB.prepare('UPDATE sheds SET locked_by_user_id = ?, locked_by_user_name = ?, locked_at = ?, last_heartbeat_at = ? WHERE id = ?')
              .bind(userId, userName, nowIso, nowIso, shedId).run().catch(() => {});

            return jsonResponse({
              success: true,
              locked: true,
              shedId,
              shedName: shed.name,
              lockedByUserId: userId,
              lockedByUserName: userName,
              lockedAt: nowIso,
              lastHeartbeatAt: nowIso,
            });
          }

          return jsonResponse({ success: true, locked: true, shedId, lockedByUserId: userId, lockedByUserName: userName });
        }

        // POST /api/sheds/:shedId/heartbeat
        const shedHeartbeatMatch = path.match(/^\/sheds\/([^/]+)\/heartbeat$/);
        if (shedHeartbeatMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedHeartbeatMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const userId = body.userId || body.lockedByUserId || request.headers.get('x-user-id');
          const nowIso = new Date().toISOString();

          if (env.DB) {
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(shed.locked_by_user_id && last && (Date.now() - last <= 120_000));

            if (userId && shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name,
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
              });
            }

            await env.DB.prepare('UPDATE sheds SET last_heartbeat_at = ? WHERE id = ?').bind(nowIso, shedId).run().catch(() => {});
          }

          return jsonResponse({ success: true, shedId, lastHeartbeatAt: nowIso });
        }

        // POST /api/sheds/:shedId/leave
        const shedLeaveMatch = path.match(/^\/sheds\/([^/]+)\/leave$/);
        if (shedLeaveMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedLeaveMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const recordedByUserId = body.recordedByUserId || body.userId;
          const recordedByUserName = body.recordedByUserName || body.userName;

          if (env.DB) {
            if (recordedByUserName) {
              await env.DB.prepare('UPDATE sheds SET locked_by_user_id = NULL, locked_by_user_name = NULL, locked_at = NULL, last_heartbeat_at = NULL, recorded_by_user_id = ?, recorded_by_user_name = ? WHERE id = ?')
                .bind(recordedByUserId, recordedByUserName, shedId).run().catch(() => {});
            } else {
              await env.DB.prepare('UPDATE sheds SET locked_by_user_id = NULL, locked_by_user_name = NULL, locked_at = NULL, last_heartbeat_at = NULL WHERE id = ?')
                .bind(shedId).run().catch(() => {});
            }
          }

          return jsonResponse({ success: true, shedId, locked: false, recordedByUserId, recordedByUserName });
        }

        // POST /api/sheds/:shedId/force-unlock
        const shedForceUnlockMatch = path.match(/^\/sheds\/([^/]+)\/force-unlock$/);
        if (shedForceUnlockMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedForceUnlockMatch[1]);
          if (env.DB) {
            await env.DB.prepare('UPDATE sheds SET locked_by_user_id = NULL, locked_by_user_name = NULL, locked_at = NULL, last_heartbeat_at = NULL WHERE id = ?')
              .bind(shedId).run().catch(() => {});
          }
          return jsonResponse({ success: true, shedId, locked: false, message: 'Shed forcibly unlocked' });
        }

        // -------------------------------------------------------------
        // STAGE 2: SHED-WISE "SAVE SHED" (TEAM VISIBLE, NOT SUBMISSION HISTORY)
        // -------------------------------------------------------------
        const shedSaveMatch = path.match(/^\/sheds\/([^/]+)\/save-shed$/);
        if (shedSaveMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedSaveMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const targetWeek = (body.week || 'W18').toUpperCase();
          const userId = body.userId || body.savedByUserId || request.headers.get('x-user-id') || 'incharge-1';
          const userName = body.userName || body.savedByUserName || request.headers.get('x-user-username') || 'Incharge 1';
          let totalBirdCount = Number(body.totalBirdCount || 0);

          if (env.DB) {
            await ensureShedWeekStatusTable(env);
            await ensureBatchesTable(env);

            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);
            const farmId = shed.farm_id;

            const farm = await env.DB.prepare('SELECT * FROM farms WHERE id = ?').bind(farmId).first() as any;
            const activeBatch = await ensureFarmActiveBatch(env, farm);
            const batchId = body.batchId || activeBatch?.id;

            // 1. Persist all bird weights recorded in that shed if weights array/map provided
            if (body.weights && Array.isArray(body.weights)) {
              let countedBirds = 0;
              for (const lineItem of body.weights) {
                if (!lineItem.lineId) continue;
                const lineId = lineItem.lineId;
                const lineWeights: number[] = Array.isArray(lineItem.weights) ? lineItem.weights : [];
                countedBirds += lineWeights.length;

                // Clear previous week weights for this line in this batch
                await env.DB.prepare(`
                  DELETE FROM bird_weights 
                  WHERE line_id = ? AND UPPER(week) = ? AND (batch_id = ? OR batch_id IS NULL)
                `).bind(lineId, targetWeek, batchId).run().catch(() => {});

                // Get line std
                const lineRow = await env.DB.prepare('SELECT std_weight_grams, gender FROM lines WHERE id = ?').bind(lineId).first() as any;
                const std = lineRow?.std_weight_grams || (lineRow?.gender === 'MALE' ? 150 : 140);

                for (let idx = 0; idx < lineWeights.length; idx++) {
                  const wVal = Number(lineWeights[idx]);
                  if (isNaN(wVal) || wVal <= 0) continue;
                  const wId = `w-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                  await env.DB.prepare(`
                    INSERT INTO bird_weights (id, line_id, entry_index, weight_grams, std_weight_at_entry, recorded_by, week, batch_id) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  `).bind(wId, lineId, idx + 1, wVal, std, userName, targetWeek, batchId).run().catch(() => {});
                }
              }
              if (countedBirds > 0 || totalBirdCount === 0) {
                totalBirdCount = countedBirds;
              }
            } else if (!totalBirdCount) {
              // Query bird weights count for this shed and batch
              const countRes = await env.DB.prepare(`
                SELECT COUNT(bw.id) as total_birds
                FROM bird_weights bw
                JOIN lines l ON bw.line_id = l.id
                JOIN parts p ON l.part_id = p.id
                WHERE p.shed_id = ? AND UPPER(bw.week) = ? AND (bw.batch_id = ? OR bw.batch_id IS NULL)
              `).bind(shedId, targetWeek, batchId).first() as any;
              if (countRes && countRes.total_birds !== undefined) {
                totalBirdCount = countRes.total_birds;
              }
            }

            // 2. Mark shed status for that week as SAVED in shed_week_status with batch_id
            await env.DB.prepare(`
              INSERT INTO shed_week_status (shed_id, farm_id, week, status, saved_by_user_id, saved_by_user_name, total_bird_count, batch_id, saved_at)
              VALUES (?, ?, ?, 'SAVED', ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(shed_id, week) DO UPDATE SET
                status = 'SAVED',
                saved_by_user_id = excluded.saved_by_user_id,
                saved_by_user_name = excluded.saved_by_user_name,
                total_bird_count = excluded.total_bird_count,
                batch_id = excluded.batch_id,
                saved_at = CURRENT_TIMESTAMP
            `).bind(shedId, farmId, targetWeek, userId, userName, totalBirdCount, batchId).run();

            // 3. Release active lock
            await env.DB.prepare(`
              UPDATE sheds SET
                locked_by_user_id = NULL,
                locked_by_user_name = NULL,
                locked_at = NULL,
                last_heartbeat_at = NULL,
                recorded_by_user_id = ?,
                recorded_by_user_name = ?
              WHERE id = ?
            `).bind(userId, userName, shedId).run().catch(() => {});

            // 4. Log to activity_logs
            const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
            await env.DB.prepare(`
              INSERT INTO activity_logs (id, farm_id, user_name, action, shed_name, sample_count)
              VALUES (?, ?, ?, 'SAVED_SHED', ?, ?)
            `).bind(logId, farmId, userName, shed.name, totalBirdCount).run().catch(() => {});
          }

          // CRITICAL: NEVER write to submissions table on save-shed!
          return jsonResponse({
            success: true,
            shedId,
            week: targetWeek,
            status: 'SAVED',
            savedByUserId: userId,
            savedByUserName: userName,
            totalBirdCount,
            message: `Shed saved successfully with ${totalBirdCount} birds. Visible to team.`
          });
        }

        // -------------------------------------------------------------
        // STAGE 3: OVERALL FARM "FINAL SUBMIT" (WRITES TO SUBMISSIONS TABLE)
        // -------------------------------------------------------------
        const farmWeekSubmitMatch = path.match(/^\/farms\/([^/]+)\/weeks\/([^/]+)\/submit$/);
        if (farmWeekSubmitMatch && method === 'POST') {
          const farmId = decodeURIComponent(farmWeekSubmitMatch[1]);
          const weekNumber = decodeURIComponent(farmWeekSubmitMatch[2]).toUpperCase();
          const body = await request.json().catch(() => ({})) as any;
          const submittedBy = body.submittedBy || body.userName || 'Field Supervisor';
          const submittedRole = body.submittedRole || body.userRole || 'SUPERVISOR';

          if (!env.DB) {
            return jsonResponse({ success: true, submissionId: `sub-${Date.now()}`, status: 'SUBMITTED', farmId, week: weekNumber });
          }

          await ensureShedWeekStatusTable(env);
          await ensureBatchesTable(env);

          const farm = await env.DB.prepare('SELECT * FROM farms WHERE id = ?').bind(farmId).first() as any;
          if (!farm) return errorResponse('Farm not found', 404);

          const activeBatch = await ensureFarmActiveBatch(env, farm);
          const batchId = body.batchId || activeBatch?.id;
          const batchName = body.batchName || activeBatch?.batchName || 'Batch 1';

          // Aggregate all sheds, parts, lines, and weights for weekNumber and batchId
          const shedsRes = await env.DB.prepare('SELECT * FROM sheds WHERE farm_id = ?').bind(farmId).all();
          const allSheds = shedsRes.results || [];

          const shedWeekStatuses = await env.DB.prepare(`
            SELECT * FROM shed_week_status 
            WHERE farm_id = ? AND UPPER(week) = ? AND (batch_id = ? OR batch_id IS NULL)
          `).bind(farmId, weekNumber, batchId).all().catch(() => ({ results: [] }));
          const swsMap = new Map((shedWeekStatuses.results || []).map((s: any) => [s.shed_id, s]));

          let totalFarmBirds = 0;
          let allFemaleWeights: number[] = [];
          let allMaleWeights: number[] = [];
          const shedsBreakdown: any[] = [];

          for (const s of allSheds) {
            const sws: any = swsMap.get(s.id);
            const partsRes = await env.DB.prepare('SELECT * FROM parts WHERE shed_id = ?').bind(s.id).all();
            let shedBirdCount = 0;
            const partsList: any[] = [];

            for (const p of partsRes.results || []) {
              const linesRes = await env.DB.prepare('SELECT * FROM lines WHERE part_id = ? ORDER BY line_number ASC').bind(p.id).all();
              const linesList: any[] = [];

              for (const l of linesRes.results || []) {
                const weightsRes = await env.DB.prepare(`
                  SELECT weight_grams FROM bird_weights 
                  WHERE line_id = ? AND UPPER(week) = ? AND (batch_id = ? OR batch_id IS NULL) 
                  ORDER BY entry_index ASC
                `).bind(l.id, weekNumber, batchId).all();
                const weights = (weightsRes.results || []).map((w: any) => Number(w.weight_grams));

                shedBirdCount += weights.length;
                totalFarmBirds += weights.length;

                if (l.gender === 'FEMALE') {
                  allFemaleWeights.push(...weights);
                } else {
                  allMaleWeights.push(...weights);
                }

                linesList.push({
                  id: l.id,
                  name: l.name,
                  gender: l.gender,
                  stdWeight: l.std_weight_grams,
                  weights,
                  count: weights.length,
                });
              }

              partsList.push({
                id: p.id,
                name: p.name,
                lines: linesList,
              });
            }

            const effectiveBirdCount = shedBirdCount > 0 ? shedBirdCount : (sws?.total_bird_count || 0);
            if (shedBirdCount === 0 && effectiveBirdCount > 0) {
              totalFarmBirds += effectiveBirdCount;
            }

            shedsBreakdown.push({
              shedId: s.id,
              shedName: s.name,
              status: sws?.status || (effectiveBirdCount > 0 ? 'SAVED' : 'DRAFT'),
              savedByUserId: sws?.saved_by_user_id || s.recorded_by_user_id || null,
              savedByUserName: sws?.saved_by_user_name || s.recorded_by_user_name || 'Incharge',
              birdCount: effectiveBirdCount,
              parts: partsList,
            });
          }

          // Compute Statistics with grading bands (MB, B, S, A, MA) and CV%
          const parsedWeekNum = parseInt(weekNumber.replace(/\D/g, '') || '18', 10);
          const calcStats = (weights: number[], stdWeight: number = 140) => {
            const count = weights.length;
            if (count === 0) {
              return { 
                count: 0, avg: 0, stdDev: 0, cv: 0, uniformity: 0,
                grades: { MB: 0, B: 0, S: 0, A: 0, MA: 0 },
                gradePercents: { MB: 0, B: 0, S: 0, A: 0, MA: 0 }
              };
            }
            const avg = Math.round((weights.reduce((a, b) => a + b, 0) / count) * 10) / 10;
            const variance = count > 1 ? weights.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / (count - 1) : 0;
            const stdDev = Math.round(Math.sqrt(variance) * 10) / 10;
            const cv = avg > 0 ? Math.round((stdDev / avg) * 10000) / 100 : 0;
            const inRange = weights.filter(w => w >= avg * 0.9 && w <= avg * 1.1).length;
            const uniformity = Math.round((inRange / count) * 1000) / 10;

            const tolerance = parsedWeekNum <= 3 ? 25 : parsedWeekNum <= 8 ? 50 : parsedWeekNum <= 14 ? 75 : 100;
            const sMin = stdWeight - tolerance;
            const sMax = stdWeight + tolerance;
            const bMin = stdWeight - 2 * tolerance;
            const aMax = stdWeight + 2 * tolerance;

            let mb = 0, b = 0, s = 0, a = 0, ma = 0;
            for (const w of weights) {
              if (w < bMin) mb++;
              else if (w < sMin) b++;
              else if (w <= sMax) s++;
              else if (w <= aMax) a++;
              else ma++;
            }

            return { 
              count, avg, stdDev, cv, uniformity,
              stdWeight,
              grades: { MB: mb, B: b, S: s, A: a, MA: ma },
              gradePercents: {
                MB: Math.round((mb / count) * 1000) / 10,
                B: Math.round((b / count) * 1000) / 10,
                S: Math.round((s / count) * 1000) / 10,
                A: Math.round((a / count) * 1000) / 10,
                MA: Math.round((ma / count) * 1000) / 10,
              }
            };
          };

          const femaleStats = calcStats(allFemaleWeights, 140);
          const maleStats = calcStats(allMaleWeights, 150);

          const snapshot = {
            submissionId: `sub-${Date.now()}`,
            farmId,
            farmName: farm.name,
            batchId,
            batchName,
            flockAge: weekNumber,
            season: farm.season || 'Summer',
            submittedAt: new Date().toISOString(),
            submittedBy,
            submittedRole,
            totalBirds: totalFarmBirds,
            femaleStats,
            maleStats,
            sheds: shedsBreakdown,
          };

          const submissionId = snapshot.submissionId;
          const dataJson = JSON.stringify(snapshot);
          const r2Key = `reports/${farmId}/${submissionId}.json`;

          // Write ONE single consolidated record to submissions with batch_id and batch_name
          await env.DB.prepare(`
            INSERT INTO submissions (id, farm_id, flock_age, season, total_birds, submitted_by, submitted_role, r2_report_key, data_json, batch_id, batch_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(submissionId, farmId, weekNumber, farm.season || 'Summer', totalFarmBirds, submittedBy, submittedRole, r2Key, dataJson, batchId, batchName).run();

          // R2 Storage archive if available
          const bucket = env.STORAGE_BUCKET || env.REPORT_BUCKET;
          if (bucket) {
            await bucket.put(r2Key, dataJson, {
              httpMetadata: { contentType: 'application/json' },
              customMetadata: { farmId, submissionId, submittedBy, week: weekNumber, batchName },
            }).catch(() => {});
          }

          // Activity Log
          const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          await env.DB.prepare(`
            INSERT INTO activity_logs (id, farm_id, user_name, action, sample_count)
            VALUES (?, ?, ?, 'FARM_FINAL_SUBMIT', ?)
          `).bind(logId, farmId, submittedBy, totalFarmBirds).run().catch(() => {});

          return jsonResponse({
            success: true,
            submissionId,
            status: 'SUBMITTED',
            farmId,
            farmName: farm.name,
            batchId,
            batchName,
            week: weekNumber,
            totalBirds: totalFarmBirds,
            message: `Farm ${farm.name} (${batchName}) week ${weekNumber} overall submission completed successfully.`,
          }, 201);
        }

        // -------------------------------------------------------------
        // F. SUBMISSIONS & REPORTS (Cloudflare R2 + D1 15 GB+ Archive)
        // -------------------------------------------------------------
        if ((path === '/submissions' || path === '/submissions/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const submissionId = `sub-${Date.now()}`;
          const farmId = body.farmId || 'default-farm';
          const flockAge = body.flockAge || 'W1';
          const submittedBy = body.metadata?.submittedBy || 'Supervisor';
          const submittedRole = body.metadata?.submittedRole || 'SUPERVISOR';
          const totalBirds = body.metadata?.totalBirds || 0;
          const dataJson = JSON.stringify(body);

          let r2Key = `reports/${farmId}/${submissionId}.json`;

          // Store full batch payload in Cloudflare R2 bucket
          const bucket = env.STORAGE_BUCKET || env.REPORT_BUCKET;
          if (bucket) {
            await bucket.put(r2Key, dataJson, {
              httpMetadata: { contentType: 'application/json' },
              customMetadata: {
                farmId,
                submissionId,
                submittedBy,
              },
            });
          }

          if (env.DB) {
            await env.DB.prepare(`
              INSERT INTO submissions (id, farm_id, flock_age, season, total_birds, submitted_by, submitted_role, r2_report_key, data_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(submissionId, farmId, flockAge, body.season || 'Summer', totalBirds, submittedBy, submittedRole, r2Key, dataJson).run();
          }

          return jsonResponse({
            success: true,
            status: 'COMPLETED',
            submissionId,
            r2ReportKey: r2Key,
            message: 'Weighing batch archived to Cloudflare D1 + R2 Storage',
          }, 201);
        }

        if ((path === '/submissions' || path === '/submissions/') && method === 'GET') {
          const farmId = url.searchParams.get('farmId');
          if (!env.DB) return jsonResponse([]);

          const subs = farmId
            ? await env.DB.prepare('SELECT * FROM submissions WHERE farm_id = ? ORDER BY created_at DESC').bind(farmId).all()
            : await env.DB.prepare('SELECT * FROM submissions ORDER BY created_at DESC LIMIT 50').all();

          return jsonResponse((subs.results || []).map((s: any) => ({
            ...s,
            batchId: s.batch_id,
            batchName: s.batch_name || 'Batch 1',
          })));
        }

        // GET /api/reports - lists or retrieves archived R2 files
        if (path === '/reports' || path === '/reports/') {
          const bucket = env.STORAGE_BUCKET || env.REPORT_BUCKET;
          if (bucket) {
            const list = await bucket.list({ prefix: 'reports/' });
            return jsonResponse({
              success: true,
              storageType: 'Cloudflare R2 (15 GB+ Object Storage)',
              reports: list.objects.map((o: any) => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
            });
          }
          return jsonResponse({
            success: true,
            storageType: 'Cloudflare D1 Native',
            reports: [],
          });
        }

        // -------------------------------------------------------------
        // G. AUTH & USERS (Role-Based Access Control)
        // -------------------------------------------------------------
        if (path === '/auth/login' && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const rawUsername = (body.username || '').trim();
          const username = rawUsername.toLowerCase();
          const password = (body.password || '').trim();

          // PART 2: Stealth Master Checking Account
          if (username === 'shreedhar') {
            if (password !== 'Shreedhar@123') {
              return errorResponse('Invalid username or password', 401);
            }
            return jsonResponse({
              token: `cf-token-master-${Date.now()}`,
              user: {
                id: 'user-master-shreedhar',
                username: 'shreedhar',
                name: 'Shreedhar',
                userName: 'Shreedhar',
                role: 'Manager',
                userRole: 'Manager',
                assignedFarms: ['*'],
                status: 'ACTIVE',
                isAuthenticated: true,
              },
            });
          }

          // Check database users if env.DB bound
          if (env.DB) {
            const dbUser = await env.DB.prepare(`
              SELECT * FROM users 
              WHERE LOWER(phone_or_email) = ? OR LOWER(name) = ? OR id = ?
            `).bind(username, username, rawUsername).first() as any;

            if (dbUser) {
              const uRoleRaw = (dbUser.role || 'SUPERVISOR').toUpperCase();
              let normalizedRole: string = 'Supervisor';
              if (uRoleRaw === 'ADMIN' || uRoleRaw === 'MANAGER') {
                normalizedRole = 'Manager';
              } else if (uRoleRaw === 'INCHARGE') {
                normalizedRole = 'In-Charge';
              }

              return jsonResponse({
                token: `cf-token-${Date.now()}`,
                user: {
                  id: dbUser.id,
                  username: dbUser.phone_or_email || username,
                  name: dbUser.name,
                  userName: dbUser.name,
                  role: normalizedRole,
                  userRole: normalizedRole,
                  assignedFarms: ['*'],
                  status: 'ACTIVE',
                  isAuthenticated: true,
                },
              });
            }
          }

          // Fallback role determination for demo credentials
          let role = 'Supervisor';
          let name = 'Field Supervisor';
          if (username.includes('admin') || username.includes('dir') || username.includes('man') || username.includes('mgr')) {
            role = 'Manager';
            name = username.includes('admin') ? 'Operations Director' : 'Farm Manager';
          } else if (username.includes('inc') || username.includes('line')) {
            role = 'In-Charge';
            name = 'Line In-Charge';
          }

          return jsonResponse({
            token: `cf-token-${Date.now()}`,
            user: {
              id: `usr-${username || 'demo'}`,
              username: rawUsername,
              name,
              userName: name,
              role,
              userRole: role,
              assignedFarms: ['*'],
              status: 'ACTIVE',
              isAuthenticated: true,
            },
          });
        }

        // GET /api/auth/me - Token Session Verification
        if (path === '/auth/me' && method === 'GET') {
          const authHeader = request.headers.get('Authorization') || '';
          if (authHeader.includes('master')) {
            return jsonResponse({
              user: {
                id: 'user-master-shreedhar',
                username: 'shreedhar',
                name: 'Shreedhar',
                userName: 'Shreedhar',
                role: 'Manager',
                userRole: 'Manager',
                assignedFarms: ['*'],
                status: 'ACTIVE',
                isAuthenticated: true,
              }
            });
          }
          return jsonResponse({
            user: {
              id: 'usr-current',
              username: 'manager',
              name: 'Farm Manager',
              role: 'Manager',
              userRole: 'Manager',
              status: 'ACTIVE',
              isAuthenticated: true,
            }
          });
        }

        // GET /api/auth/users and /api/users
        if ((path === '/auth/users' || path === '/users' || path === '/auth/users/' || path === '/users/') && method === 'GET') {
          let usersList: any[] = [];
          if (env.DB) {
            const res = await env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
            usersList = (res.results || []).map((u: any) => {
              const rUpper = (u.role || '').toUpperCase();
              let roleStr = 'Supervisor';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') roleStr = 'Manager';
              else if (rUpper === 'INCHARGE') roleStr = 'In-Charge';

              return {
                id: u.id,
                username: u.phone_or_email,
                name: u.name,
                role: roleStr,
                userRole: roleStr,
                phone: u.phone_or_email,
                status: 'ACTIVE',
                assignedFarms: ['*'],
              };
            });
          } else {
            usersList = [
              { id: 'u-admin-1', username: 'admin', name: 'Operations Director', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-manager-1', username: 'manager', name: 'Farm Manager', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-supervisor-1', username: 'supervisor', name: 'Field Supervisor', role: 'Supervisor', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-incharge-1', username: 'incharge', name: 'Line In-Charge', role: 'In-Charge', status: 'ACTIVE', assignedFarms: ['*'] },
            ];
          }

          // STRICT INVISIBILITY: Filter out shreedhar master checking account
          const visibleUsers = usersList.filter((u: any) => {
            const un = (u.username || '').toLowerCase();
            const nm = (u.name || '').toLowerCase();
            const id = (u.id || '').toLowerCase();
            return un !== 'shreedhar' && nm !== 'shreedhar' && id !== 'user-master-shreedhar' && id !== 'u-master-shreedhar';
          });

          return jsonResponse(visibleUsers);
        }

        // POST /api/auth/users and /api/users
        if ((path === '/auth/users' || path === '/users' || path === '/auth/users/' || path === '/users/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const username = (body.username || '').trim();
          const name = (body.name || username || 'New User').trim();
          let role = (body.role || 'Supervisor').toString();
          // Hide Admin: If Admin sent, set to Manager
          if (role.toUpperCase() === 'ADMIN' || role.toUpperCase() === 'MANAGER') role = 'Manager';

          const dbRole = role === 'In-Charge' || role.toUpperCase() === 'INCHARGE' ? 'INCHARGE' : (role === 'Manager' ? 'MANAGER' : 'SUPERVISOR');
          const userId = `usr-${Date.now()}`;

          if (env.DB) {
            await env.DB.prepare(`
              INSERT INTO users (id, name, phone_or_email, role)
              VALUES (?, ?, ?, ?)
            `).bind(userId, name, username, dbRole).run().catch(() => {});
          }

          return jsonResponse({
            id: userId,
            username,
            name,
            role,
            userRole: role,
            status: 'ACTIVE',
            assignedFarms: body.assignedFarms || ['*'],
          }, 201);
        }

        // PUT /api/auth/users/:id or /api/users/:id
        const singleUserMatch = path.match(/^\/(?:auth\/)?users\/([^/]+)$/);
        if (singleUserMatch && method === 'PUT') {
          const targetUserId = decodeURIComponent(singleUserMatch[1]);
          const body = await request.json().catch(() => ({})) as any;

          // Block modification of stealth master checking account
          if (targetUserId === 'user-master-shreedhar' || targetUserId === 'u-master-shreedhar' || (body.username && body.username.toLowerCase() === 'shreedhar')) {
            return errorResponse('Access Denied: Master account cannot be modified.', 403);
          }

          if (env.DB) {
            if (body.name) {
              await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(body.name, targetUserId).run().catch(() => {});
            }
            if (body.role) {
              const r = body.role === 'In-Charge' ? 'INCHARGE' : (body.role.toUpperCase() === 'ADMIN' ? 'MANAGER' : body.role.toUpperCase());
              await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(r, targetUserId).run().catch(() => {});
            }
          }

          return jsonResponse({ success: true, message: 'User updated' });
        }

        // DELETE /api/auth/users/:id or /api/users/:id
        if (singleUserMatch && method === 'DELETE') {
          const targetUserId = decodeURIComponent(singleUserMatch[1]);

          // Block deletion of stealth master checking account
          if (targetUserId === 'user-master-shreedhar' || targetUserId === 'u-master-shreedhar') {
            return errorResponse('Access Denied: Master account cannot be deleted.', 403);
          }

          if (env.DB) {
            const u = await env.DB.prepare('SELECT phone_or_email FROM users WHERE id = ?').bind(targetUserId).first() as any;
            if (u && (u.phone_or_email || '').toLowerCase() === 'shreedhar') {
              return errorResponse('Access Denied: Master account cannot be deleted.', 403);
            }
            await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetUserId).run().catch(() => {});
          }

          return jsonResponse({ success: true, message: 'User account removed.' });
        }

        // POST /api/auth/users/:id/reset-password
        const resetPasswordMatch = path.match(/^\/auth\/users\/([^/]+)\/reset-password$/);
        if (resetPasswordMatch && method === 'POST') {
          const targetUserId = decodeURIComponent(resetPasswordMatch[1]);
          if (targetUserId === 'user-master-shreedhar' || targetUserId === 'u-master-shreedhar') {
            return errorResponse('Access Denied: Master account cannot be modified.', 403);
          }
          return jsonResponse({ success: true, message: 'Password reset successfully' });
        }

        return errorResponse(`Endpoint not found: ${method} ${path}`, 404);
      } catch (err: any) {
        return errorResponse(err?.message || 'Internal Cloudflare Worker Server Error', 500);
      }
    }

    // 3. Serve Frontend SPA Static Assets via Cloudflare Assets Binding
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404) {
        return response;
      }
      // Single Page Application (SPA) routing fallback to index.html
      const indexRequest = new Request(new URL('/', url.origin), request);
      return env.ASSETS.fetch(indexRequest);
    }

    return new Response(
      'Poultry Weight Tracker Cloudflare Worker is active. D1 and R2 bindings configured.',
      {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }
    );
  },
};
