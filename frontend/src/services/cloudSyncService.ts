import { ShedData } from './excelExportService';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
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
  status: string; // 'LIVE' | 'COMPLETED'
  timestamp: string; // ISO string
  isLive: boolean;
}

export interface FarmSummary {
  id: string;
  name: string;
  flockDate: string;
  ageWeek: string;
  season: 'Summer' | 'Winter';
  updatedAt: string;
  createdAt?: string;
  _count?: { sheds: number };
}

export interface FullFarmData {
  id: string;
  name: string;
  flockDate: string;
  ageWeek: string;
  season: 'Summer' | 'Winter';
  updatedAt: string;
  createdAt?: string;
  sheds: ShedData[];
}

// Get the base API URL (default to env var, fallback to relative /api or localhost:10000/api)
export function getApiBaseUrl(): string {
  const custom = localStorage.getItem('poultry_custom_api_url');
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  // If running on localhost Vite (port 5173), target backend default port 10000
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:10000/api';
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
  async createFarm(data: { name: string; flockDate?: string; ageWeek?: string; season?: string }): Promise<FullFarmData> {
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
  async syncFullFarm(farmId: string, data: { name: string; flockDate: string; ageWeek: string; season: string; sheds: ShedData[] }): Promise<FullFarmData> {
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
};
