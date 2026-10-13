import { ShedData } from './excelExportService';

export type UserRole = 'Admin' | 'Manager' | 'Supervisor';

export interface AppUser {
  id: string;
  name: string;
  email?: string;
  role: UserRole | string;
  userRole?: UserRole;
  userName?: string;
  isAuthenticated?: boolean;
}

export type FarmStatus = 'DRAFT' | 'COMPLETED';

export interface FarmAudit {
  status?: FarmStatus;
  lastSavedAsDraftAt?: string;
  lastEditedBy?: string;
  lastEditedRole?: string;
  lastSubmittedAt?: string;    // Formatted or ISO timestamp
  lastSubmittedBy?: string;    // User Name
  lastSubmittedRole?: string;  // Role
  submittedBy?: string;
  submittedRole?: string;
  totalBirdsSubmitted?: number;
  totalBirdsAtLastSubmit?: number;
  femaleAvgWeight?: number;
  maleAvgWeight?: number;
  isPendingSubmission?: boolean; // True if local staged entries exist since last submit
}

export interface ActivityLogItem {
  id: string;
  farmId: string;
  farmName: string;
  userId?: string | null;
  userName: string;
  action: string;
  shedName?: string;
  partName?: string;
  lineName?: string;
  sampleCount: number;
  avgWeight?: number;
  femaleAvgWeight?: number;
  maleAvgWeight?: number;
  status: string; // 'COMPLETED'
  timestamp: string; // ISO string
  isLive?: boolean;
}

export interface FarmSummary {
  id: string;
  name: string;
  flockDate: string;
  ageWeek: string;
  season: 'Summer' | 'Winter';
  status?: FarmStatus;
  progressPercentage?: number;
  updatedAt: string;
  createdAt?: string;
  _count?: { sheds: number };
  audit?: FarmAudit;
}

export interface FullFarmData {
  id: string;
  name: string;
  flockDate: string;
  ageWeek: string;
  season: 'Summer' | 'Winter';
  status?: FarmStatus;
  progressPercentage?: number;
  updatedAt: string;
  createdAt?: string;
  sheds: ShedData[];
  audit?: FarmAudit;
}

// Normalize API URL to ensure valid protocol and clean /api suffix without duplicates
export function normalizeApiUrl(rawUrl: string): string {
  let trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return 'https://poultry-weight-backend.onrender.com/api';
  }
  // Default to https if no protocol specified
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }
  // Remove any duplicate trailing slashes
  trimmed = trimmed.replace(/\/+$/, '');
  // Ensure the URL ends with /api
  if (!trimmed.endsWith('/api')) {
    trimmed = `${trimmed}/api`;
  }
  return trimmed;
}

// Get the base API URL (custom > env var > localhost > production Render)
export function getApiBaseUrl(): string {
  const custom = localStorage.getItem('poultry_custom_api_url');
  if (custom && custom.trim()) {
    return normalizeApiUrl(custom);
  }
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim()) {
    return normalizeApiUrl(envUrl);
  }
  // Local development fallback
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:5000/api';
  }
  // Production fallback on Render
  return 'https://poultry-weight-backend.onrender.com/api';
}

export const cloudApi = {
  // 1. Fetch all farm summaries
  async getFarms(): Promise<FarmSummary[]> {
    const res = await fetch(`${getApiBaseUrl()}/farms`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Failed to fetch farms (${res.status})`);
    return res.json();
  },

  // 2. Create new farm
  async createFarm(data: {
    name: string;
    flockDate?: string;
    ageWeek?: string;
    season?: string;
    shedCount?: number;
    defaultSexSplit?: string;
  }): Promise<FullFarmData> {
    const res = await fetch(`${getApiBaseUrl()}/farms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create farm (${res.status})`);
    return res.json();
  },

  // 3. Get full farm details by ID
  async getFarmDetails(farmId: string): Promise<FullFarmData> {
    const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Failed to fetch farm details (${res.status})`);
    return res.json();
  },

  // 4. Update farm metadata details
  async updateFarmDetails(farmId: string, data: { name?: string; flockDate?: string; ageWeek?: string; season?: string }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}/details`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update farm details (${res.status})`);
    return res.json();
  },

  // 5. Delete farm
  async deleteFarm(farmId: string): Promise<boolean> {
    const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}`, {
      method: 'DELETE',
    });
    return res.ok;
  },

  // 6. Push single weight entry
  async pushWeight(lineId: string | number, weight: number, meta?: { userName?: string; userId?: string }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/lines/${lineId}/weight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight, userName: meta?.userName, userId: meta?.userId }),
    });
    if (!res.ok) throw new Error(`Failed to push weight (${res.status})`);
    return res.json();
  },

  // 7. Delete weight entry by index
  async deleteWeight(lineId: string | number, index: number): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/lines/${lineId}/weight/${index}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete weight (${res.status})`);
    return res.json();
  },

  // 8. Clear all weights in a line
  async clearLineWeights(lineId: string | number): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/lines/${lineId}/clear`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`Failed to clear line weights (${res.status})`);
    return res.json();
  },

  // 9. Add new shed
  async addShed(data: { farmId: string; name: string; type: 'Female' | 'Male'; order?: number }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/sheds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to add shed (${res.status})`);
    return res.json();
  },

  // 10. Delete shed
  async deleteShed(shedId: string): Promise<boolean> {
    const res = await fetch(`${getApiBaseUrl()}/sheds/${shedId}`, {
      method: 'DELETE',
    });
    return res.ok;
  },

  // 11. Rename shed
  async updateShed(shedId: string, data: { name?: string; type?: 'Female' | 'Male' }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/sheds/${shedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // 12. Add Part
  async addPart(data: { shedId: string; name: string; order?: number }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/parts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // 13. Delete Part
  async deletePart(partId: string): Promise<boolean> {
    const res = await fetch(`${getApiBaseUrl()}/parts/${partId}`, {
      method: 'DELETE',
    });
    return res.ok;
  },

  // 14. Rename Part
  async updatePart(partId: string, name: string): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/parts/${partId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return res.json();
  },

  // 15. Add Line
  async addLine(data: { partId: string; name?: string }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // 16. Delete Line
  async deleteLine(lineId: string | number): Promise<boolean> {
    const res = await fetch(`${getApiBaseUrl()}/lines/${lineId}`, {
      method: 'DELETE',
    });
    return res.ok;
  },

  // 17. Full Farm Sync
  async syncFullFarm(farmId: string, data: {
    name: string;
    flockDate: string;
    ageWeek: string;
    season: string;
    status?: FarmStatus;
    progressPercentage?: number;
    sheds: ShedData[];
    audit?: FarmAudit;
  }): Promise<FullFarmData> {
    const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}/sync`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Full sync failed (${res.status})`);
    return res.json();
  },

  // 18. Register
  async register(data: { name: string; email: string; password: string; role?: string }): Promise<{ user: AppUser }> {
    const res = await fetch(`${getApiBaseUrl()}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Registration failed' }));
      throw new Error(err.error || `Registration failed (${res.status})`);
    }
    return res.json();
  },

  // 19. Login
  async login(data: { email: string; password: string }): Promise<{ user: AppUser }> {
    const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || `Login failed (${res.status})`);
    }
    return res.json();
  },

  // 20. Get Users
  async getUsers(): Promise<AppUser[]> {
    const res = await fetch(`${getApiBaseUrl()}/auth/users`);
    if (!res.ok) throw new Error(`Failed to fetch users (${res.status})`);
    return res.json();
  },

  // 21. Get Activity Logs
  async getLogs(params?: { farmId?: string; liveOnly?: boolean; limit?: number }): Promise<ActivityLogItem[]> {
    const query = new URLSearchParams();
    if (params?.farmId) query.append('farmId', params.farmId);
    if (params?.liveOnly) query.append('liveOnly', 'true');
    if (params?.limit) query.append('limit', String(params.limit));

    const qs = query.toString();
    const url = `${getApiBaseUrl()}/logs${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch logs (${res.status})`);
    return res.json();
  },

  // 22. Create Activity Log
  async createLog(data: Partial<ActivityLogItem> & { farmId: string; userName: string }): Promise<ActivityLogItem> {
    const res = await fetch(`${getApiBaseUrl()}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create log (${res.status})`);
    return res.json();
  },

  // 23. Real-Time Diagnostics & Health Check
  async checkHealth(targetBaseUrl?: string): Promise<{
    online: boolean;
    status: string;
    databaseConnected: boolean;
    databaseStatus: string;
    databaseMessage?: string;
    databaseProvider?: string;
    latencyMs?: number;
    error?: string;
    testedUrl: string;
  }> {
    const base = targetBaseUrl ? normalizeApiUrl(targetBaseUrl) : getApiBaseUrl();
    const rootHost = base.replace(/\/api$/, '');
    const endpointsToTry = [
      `${base}/health`,
      `${rootHost}/healthz`,
      `${base}/healthz`,
      `${rootHost}/health`,
    ];

    const start = Date.now();
    let lastError = '';
    let lastStatus = 0;
    let isNoServer = false;

    for (const url of endpointsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 9000);
        const res = await fetch(url, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);

        // Check if Render returned no-server header or status
        const routingHeader = res.headers.get('x-render-routing');
        if (routingHeader === 'no-server' || res.status === 404) {
          lastStatus = res.status;
          isNoServer = true;
          continue;
        }

        if (res.ok) {
          const latencyMs = Date.now() - start;
          const data = await res.json().catch(() => ({ status: 'healthy', database: { status: 'unknown' } }));
          const dbConnected = data?.database?.status === 'connected' || data?.database === 'healthy';
          return {
            online: true,
            status: data?.status || 'healthy',
            databaseConnected: dbConnected,
            databaseStatus: data?.database?.status || (dbConnected ? 'connected' : 'disconnected'),
            databaseMessage: data?.database?.message,
            databaseProvider: data?.database?.provider || 'postgresql',
            latencyMs,
            testedUrl: url,
          };
        } else {
          lastStatus = res.status;
        }
      } catch (err: any) {
        lastError = err?.message || 'Network request failed';
      }
    }

    let errorDetail = 'Could not reach backend URL.';
    if (isNoServer) {
      errorDetail = 'Render Service Not Found (404 no-server). Please verify your Web Service name in Render Dashboard or deploy the service.';
    } else if (lastError.toLowerCase().includes('abort')) {
      errorDetail = 'Request timed out (9s). If using Render free tier, service may be cold-booting (takes 30-50s). Please retry in a few seconds.';
    } else if (lastError) {
      errorDetail = `${lastError} (Check internet or CORS settings).`;
    }

    return {
      online: false,
      status: 'unreachable',
      databaseConnected: false,
      databaseStatus: 'unreachable',
      error: errorDetail,
      testedUrl: base,
    };
  },
};

// --------------------------------------------------------------------------
// Offline Sync Queue - Ensures zero data loss when offline
// --------------------------------------------------------------------------
export interface PendingSyncItem {
  id: string;
  type: 'PUSH_WEIGHT' | 'DELETE_WEIGHT' | 'SYNC_FARM';
  payload: any;
  timestamp: string;
  retries: number;
}

export const offlineQueue = {
  getQueue(): PendingSyncItem[] {
    try {
      const saved = localStorage.getItem('poultry_offline_queue_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  },

  enqueue(action: Omit<PendingSyncItem, 'id' | 'timestamp' | 'retries'>): void {
    const queue = this.getQueue();
    const item: PendingSyncItem = {
      ...action,
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      retries: 0,
    };
    queue.push(item);
    localStorage.setItem('poultry_offline_queue_v1', JSON.stringify(queue));
  },

  count(): number {
    return this.getQueue().length;
  },

  clear(): void {
    localStorage.removeItem('poultry_offline_queue_v1');
  },

  async flush(): Promise<{ successCount: number; remainingCount: number }> {
    const queue = this.getQueue();
    if (queue.length === 0) return { successCount: 0, remainingCount: 0 };

    let successCount = 0;
    const remaining: PendingSyncItem[] = [];

    for (const item of queue) {
      try {
        if (item.type === 'PUSH_WEIGHT') {
          await cloudApi.pushWeight(item.payload.lineId, item.payload.weight, item.payload.meta);
          successCount++;
        } else if (item.type === 'DELETE_WEIGHT') {
          await cloudApi.deleteWeight(item.payload.lineId, item.payload.index);
          successCount++;
        } else if (item.type === 'SYNC_FARM') {
          await cloudApi.syncFullFarm(item.payload.farmId, item.payload.data);
          successCount++;
        }
      } catch (err) {
        item.retries += 1;
        remaining.push(item);
      }
    }

    localStorage.setItem('poultry_offline_queue_v1', JSON.stringify(remaining));
    return { successCount, remainingCount: remaining.length };
  },
};
