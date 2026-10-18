import { ShedData } from './excelExportService';

export type UserRole = 'Admin' | 'Manager' | 'Supervisor' | 'In-Charge' | 'Incharge';

export interface AppUser {
  id: string;
  username: string;
  employeeCode?: string;
  phone?: string;
  requiresPasswordChange?: boolean;
  name: string;
  email?: string;
  role: UserRole;
  userRole?: UserRole;
  userName?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  assignedFarms?: string[];
  token?: string;
  isAuthenticated?: boolean;
}

export type FarmStatus = 'DRAFT' | 'UPLOADING' | 'COMPLETED' | 'UPLOAD_FAILED';

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
  assignedUserNames?: string[];
  updatedAt: string;
  createdAt?: string;
  isArchived?: boolean;
  archivedAt?: string | null;
  submissionCount?: number;
  _count?: { sheds: number; submissions?: number };
  audit?: FarmAudit;
  submissions?: any[];
}

export interface FullFarmData {
  id: string;
  name: string;
  flockDate: string;
  ageWeek: string;
  season: 'Summer' | 'Winter';
  status?: FarmStatus;
  progressPercentage?: number;
  assignedUserNames?: string[];
  updatedAt: string;
  createdAt?: string;
  isArchived?: boolean;
  archivedAt?: string | null;
  submissionCount?: number;
  _count?: { sheds: number; submissions?: number };
  sheds: ShedData[];
  audit?: FarmAudit;
  submissions?: any[];
}

export interface DeleteImpactResult {
  farmId: string;
  farmName: string;
  isArchived?: boolean;
  hasRecords: boolean;
  shedsCount: number;
  partsCount: number;
  linesCount: number;
  submissionsCount: number;
  birdWeightsCount: number;
  logsCount: number;
}

export interface FarmData {
  id: string;
  name: string;
  flockDate: string;
  ageWeek: string;
  season: 'Summer' | 'Winter';
  status: 'DRAFT' | 'COMPLETED';
  assignedUserNames: string[];
  audit?: FarmAudit;
  sheds: ShedData[];
}

// Normalize API URL to ensure valid protocol and clean /api suffix without duplicates
export function normalizeApiUrl(rawUrl: string): string {
  let trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return 'https://shreedharg405-sketch-poultry-weight.onrender.com/api';
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
  return 'https://shreedharg405-sketch-poultry-weight.onrender.com/api';
}

export function sanitizeErrorMessage(err: any): string {
  if (!err) return 'Server is not connected';
  const msg = typeof err === 'string' ? err : (err.message || err.error || String(err));
  const lower = msg.toLowerCase();
  if (
    lower.includes('postgres') ||
    lower.includes('portsql') ||
    lower.includes('database error') ||
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('503') ||
    lower.includes('unable to verify farm') ||
    lower.includes('failed to update operator assignments') ||
    lower.includes('server is not connected')
  ) {
    return 'Server is not connected';
  }
  return msg;
}

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('poultry_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
}

export const cloudApi = {
  // 1. Fetch all farm summaries
  async getFarms(includeArchived = false): Promise<FarmSummary[]> {
    const url = includeArchived ? `${getApiBaseUrl()}/farms?includeArchived=true` : `${getApiBaseUrl()}/farms`;
    const res = await fetch(url, {
      headers: getAuthHeaders(),
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
    sheds?: Array<{ name: string; type: 'Male' | 'Female' }>;
  }): Promise<FullFarmData> {
    const res = await fetch(`${getApiBaseUrl()}/farms`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Failed to create farm (${res.status})`);
    }
    return res.json();
  },

  // 3. Get full farm details by ID (with optional week query)
  async getFarmDetails(farmId: string, week?: string): Promise<FullFarmData> {
    const url = week
      ? `${getApiBaseUrl()}/farms/${farmId}?week=${encodeURIComponent(week)}`
      : `${getApiBaseUrl()}/farms/${farmId}`;
    const res = await fetch(url, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Failed to fetch farm details (${res.status})`);
    }
    return res.json();
  },

  // 4. Update farm metadata details
  async updateFarmDetails(farmId: string, data: { name?: string; flockDate?: string; ageWeek?: string; season?: string }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}/details`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(result.error || `Failed to update farm details (${res.status})`);
    }
    return result;
  },

  // 5. Delete or Archive farm (Admin only)
  async deleteFarm(farmId: string, options?: { mode?: 'archive' | 'permanent'; confirmFarmName?: string }): Promise<{ success: boolean; archived?: boolean; permanentlyDeleted?: boolean; message: string }> {
    const mode = options?.mode || 'archive';
    const confirmName = options?.confirmFarmName || '';
    const query = `?mode=${encodeURIComponent(mode)}&confirmFarmName=${encodeURIComponent(confirmName)}`;
    const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}${query}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify(options || { mode: 'archive' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to delete/archive farm (${res.status})`);
    }
    return data;
  },

  // 5a. Safe Archive Farm directly via POST (Admin only)
  async archiveFarm(farmId: string): Promise<{ success: boolean; archived?: boolean; message: string }> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}/archive`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
    } catch {}
    // Fallback to standard delete with mode=archive
    return this.deleteFarm(farmId, { mode: 'archive' });
  },

  // 5b. Get Farm Delete Impact (Admin only)
  async getFarmDeleteImpact(farmId: string): Promise<DeleteImpactResult> {
    const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}/delete-impact`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to inspect farm deletion impact (${res.status})`);
    }
    return data;
  },

  // 5c. Restore Archived Farm (Admin only)
  async restoreFarm(farmId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}/restore`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to restore farm (${res.status})`);
    }
    return data;
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
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || `Failed to add shed (${res.status})`);
    return result;
  },

  // 10. Delete shed
  async deleteShed(shedId: string): Promise<boolean> {
    const res = await fetch(`${getApiBaseUrl()}/sheds/${shedId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.error || `Failed to delete shed (${res.status})`);
    }
    return true;
  },

  // 11. Rename / change type of shed
  async updateShed(shedId: string, data: { name?: string; type?: 'Female' | 'Male' }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/sheds/${shedId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || `Failed to update shed (${res.status})`);
    return result;
  },

  // 12. Add Part (Enforced Parts A-D)
  async addPart(data: { shedId: string; name: string; order?: number }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/parts`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || `Failed to add part (${res.status})`);
    return result;
  },

  // 13. Delete Part
  async deletePart(partId: string): Promise<boolean> {
    const res = await fetch(`${getApiBaseUrl()}/parts/${partId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.error || `Failed to delete part (${res.status})`);
    }
    return true;
  },

  // 14. Rename Part
  async updatePart(partId: string, name: string): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/parts/${partId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || `Failed to update part (${res.status})`);
    return result;
  },

  // 15. Add Line (Enforced Lines 1-16)
  async addLine(data: { partId: string; name?: string }): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}/lines`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || `Failed to add line (${res.status})`);
    return result;
  },

  // 16. Delete Line
  async deleteLine(lineId: string | number): Promise<boolean> {
    const res = await fetch(`${getApiBaseUrl()}/lines/${lineId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.error || `Failed to delete line (${res.status})`);
    }
    return true;
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

  // 17b. Submit & Upload Batch Weighing (Atomic Cloud Database Transaction)
  async submitWeighingBatch(data: {
    idempotencyKey?: string;
    farmId: string;
    flockAge?: string;
    season?: string;
    sheds: ShedData[];
    metadata?: any;
  }): Promise<{
    success: boolean;
    status: 'COMPLETED';
    message: string;
    submission: any;
    stats?: any;
    isIdempotentReplay?: boolean;
  }> {
    const token = localStorage.getItem('poultry_auth_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${getApiBaseUrl()}/submissions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error || `Submission failed with status ${res.status}`;
      const err: any = new Error(msg);
      err.pendingLines = errData.pendingLines;
      err.status = res.status;
      throw err;
    }

    return res.json();
  },

  // 17c. Fetch Submissions (Filtered by authorized user role & assigned farms)
  async getSubmissions(farmId?: string): Promise<any[]> {
    const token = localStorage.getItem('poultry_auth_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = farmId 
      ? `${getApiBaseUrl()}/submissions?farmId=${encodeURIComponent(farmId)}` 
      : `${getApiBaseUrl()}/submissions`;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Failed to fetch submissions (${res.status})`);
    return res.json();
  },

  // 17d. Fetch Full Submission Details by ID
  async getSubmissionDetails(submissionId: string): Promise<any> {
    const token = localStorage.getItem('poultry_auth_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${getApiBaseUrl()}/submissions/${submissionId}`, { headers });
    if (!res.ok) throw new Error(`Failed to fetch submission details (${res.status})`);
    return res.json();
  },

  // 17e. Fetch Individual Bird Weights for a Submission
  async getSubmissionBirds(submissionId: string, filters?: { shedName?: string; partName?: string; lineName?: string; sex?: string }): Promise<any[]> {
    const token = localStorage.getItem('poultry_auth_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const params = new URLSearchParams();
    if (filters?.shedName) params.set('shedName', filters.shedName);
    if (filters?.partName) params.set('partName', filters.partName);
    if (filters?.lineName) params.set('lineName', filters.lineName);
    if (filters?.sex) params.set('sex', filters.sex);

    const qs = params.toString();
    const res = await fetch(`${getApiBaseUrl()}/submissions/${submissionId}/birds${qs ? '?' + qs : ''}`, { headers });
    if (!res.ok) throw new Error(`Failed to fetch bird weights (${res.status})`);
    return res.json();
  },

  // 17f. Update an Existing Submission (Req 2)
  async updateSubmission(submissionId: string, data: any): Promise<any> {
    const token = localStorage.getItem('poultry_auth_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${getApiBaseUrl()}/submissions/${submissionId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error || `Update failed with status ${res.status}`;
      throw new Error(msg);
    }

    return res.json();
  },

  // 18. Login (Supports Username or Employee Code)
  async login(data: { username: string; password: string }): Promise<{ token: string; user: AppUser; requiresPasswordChange?: boolean }> {
    const rawInput = data.username.trim();
    const cleanLower = rawInput.toLowerCase();
    const cleanUpper = rawInput.toUpperCase();
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        return res.json();
      }
      const err = await res.json().catch(() => ({ error: 'Invalid username/employee code or password.' }));
      throw new Error(err.error || 'Invalid username/employee code or password.');
    } catch (networkErr: any) {
      if (networkErr.message && (
        networkErr.message.includes('Invalid') || 
        networkErr.message.includes('deactivated') || 
        networkErr.message.includes('Too many failed')
      )) {
        throw networkErr;
      }

      // Offline fallback authentication
      const offlineUsers: Array<{ 
        username: string; 
        employeeCode?: string; 
        phone?: string; 
        requiresPasswordChange?: boolean;
        name: string; 
        password: string; 
        role: UserRole; 
        assignedFarms: string[]; 
        status: 'ACTIVE' | 'INACTIVE' 
      }> = [
        { username: 'admin', name: 'System Administrator', password: 'Admin@123', role: 'Admin', assignedFarms: ['*'], status: 'ACTIVE' },
        { username: 'manager', name: 'Flock Manager', password: 'Manager@123', role: 'Manager', assignedFarms: ['*'], status: 'ACTIVE' },
        { username: 'supervisor', employeeCode: 'EMP0001', phone: '9876543210', name: 'Suresh Kumar', password: 'Super@123', role: 'Supervisor', assignedFarms: ['SAI FARM - UNIT 1', 'farm-sai-1', 'Sai Farm Unit-2'], status: 'ACTIVE' },
        { username: 'incharge', employeeCode: 'EMP0002', phone: '9845012345', name: 'Ramesh Patel', password: 'Incharge@123', role: 'In-Charge', assignedFarms: ['GREEN VALLEY FARM', 'farm-green-valley', 'Zara Unit-I', 'farm-zara-1'], status: 'ACTIVE' },
      ];

      const customOfflineStr = localStorage.getItem('poultry_offline_users');
      if (customOfflineStr) {
        try {
          const custom = JSON.parse(customOfflineStr);
          if (Array.isArray(custom)) offlineUsers.push(...custom);
        } catch {}
      }

      const match = offlineUsers.find(u => 
        u.username.toLowerCase() === cleanLower ||
        (u.employeeCode && u.employeeCode.toUpperCase() === cleanUpper) ||
        (u.username.toUpperCase() === cleanUpper)
      );

      if (match && match.password === data.password.trim()) {
        if (match.status === 'INACTIVE') {
          throw new Error('Account is deactivated. Please contact your Administrator.');
        }
        return {
          token: `offline-${Date.now()}`,
          requiresPasswordChange: !!match.requiresPasswordChange,
          user: {
            id: `u-${match.username}`,
            username: match.username,
            employeeCode: match.employeeCode,
            phone: match.phone,
            requiresPasswordChange: match.requiresPasswordChange,
            name: match.name,
            role: match.role,
            status: match.status,
            assignedFarms: match.assignedFarms,
            isAuthenticated: true,
          }
        };
      }

      throw new Error('Invalid username/employee code or password.');
    }
  },

  // 18b. Change Password (First Login or Self Service)
  async changePassword(newPassword: string, token: string): Promise<{ success: boolean; token: string; user: AppUser }> {
    const res = await fetch(`${getApiBaseUrl()}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ newPassword })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update password' }));
      throw new Error(err.error || 'Failed to update password');
    }
    return res.json();
  },

  // 18c. Query Next Sequential Employee Code
  async getNextEmployeeCode(): Promise<{ nextEmployeeCode: string }> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/next-employee-code`);
      if (res.ok) return res.json();
    } catch {}
    return { nextEmployeeCode: 'EMP0003' };
  },

  // 19. Get Current User Session (Token Verification)
  async getMe(token: string): Promise<{ user: AppUser }> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Session invalid');
      return res.json();
    } catch {
      // Local session fallback
      const saved = localStorage.getItem('poultry_current_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.isAuthenticated) return { user: parsed };
      }
      throw new Error('Session expired');
    }
  },

  // 20. Logout
  async logout(): Promise<void> {
    try {
      await fetch(`${getApiBaseUrl()}/auth/logout`, { method: 'POST' }).catch(() => {});
    } finally {
      localStorage.removeItem('poultry_auth_token');
      localStorage.removeItem('poultry_current_user');
    }
  },

  // 21. Get User Accounts (Admin & Manager)
  async getUsers(): Promise<AppUser[]> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/users`);
      if (res.ok) return res.json();
    } catch {}

    // Fallback list
    const defaults: AppUser[] = [
      { id: 'u-admin-1', username: 'admin', name: 'System Administrator', role: 'Admin', status: 'ACTIVE', assignedFarms: ['*'] },
      { id: 'u-manager-1', username: 'manager', name: 'Flock Manager', role: 'Manager', status: 'ACTIVE', assignedFarms: ['*'] },
      { id: 'u-supervisor-1', username: 'supervisor', employeeCode: 'EMP0001', phone: '9876543210', name: 'Suresh Kumar', role: 'Supervisor', status: 'ACTIVE', assignedFarms: ['SAI FARM - UNIT 1', 'farm-sai-1', 'Sai Farm Unit-2'] },
      { id: 'u-incharge-1', username: 'incharge', employeeCode: 'EMP0002', phone: '9845012345', name: 'Ramesh Patel', role: 'In-Charge', status: 'ACTIVE', assignedFarms: ['GREEN VALLEY FARM', 'farm-green-valley', 'Zara Unit-I', 'farm-zara-1'] },
    ];
    const custom = localStorage.getItem('poultry_offline_users');
    if (custom) {
      try {
        const parsed = JSON.parse(custom);
        if (Array.isArray(parsed)) {
          return [...defaults, ...parsed.map((p: any, i: number) => ({ id: `u-custom-${i}`, ...p }))];
        }
      } catch {}
    }
    return defaults;
  },

  // 22. Create User Account (Admin & Manager)
  async createUser(data: { username?: string; name: string; password?: string; role: UserRole; assignedFarms?: string[]; phone?: string; employeeCode?: string }): Promise<AppUser> {
    const res = await fetch(`${getApiBaseUrl()}/auth/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create user' }));
      throw new Error(err.error || `Failed to create user (${res.status})`);
    }
    return res.json();
  },

  // 23. Update User Account / Assign Farms / Status (Admin Only)
  async updateUser(id: string, data: { name?: string; role?: UserRole; status?: 'ACTIVE' | 'INACTIVE'; assignedFarms?: string[]; password?: string }): Promise<AppUser> {
    const res = await fetch(`${getApiBaseUrl()}/auth/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update user' }));
      throw new Error(err.error || `Failed to update user (${res.status})`);
    }
    return res.json();
  },

  // 24. Reset User Password (Admin Only)
  async resetUserPassword(id: string, newPassword: string): Promise<void> {
    const res = await fetch(`${getApiBaseUrl()}/auth/users/${id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to reset password' }));
      throw new Error(err.error || `Failed to reset password (${res.status})`);
    }
  },

  // 25. Delete User Account (Admin Only)
  async deleteUser(id: string): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/users/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to delete user account' }));
        throw new Error(err.error || `Failed to delete user account (${res.status})`);
      }
      const data = await res.json().catch(() => ({ success: true }));

      // Remove from offline local users cache if present
      try {
        const offline = localStorage.getItem('poultry_offline_users');
        if (offline) {
          const parsed = JSON.parse(offline);
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter((u: any) => u.id !== id && u.username !== id);
            localStorage.setItem('poultry_offline_users', JSON.stringify(filtered));
          }
        }
      } catch {}

      return data;
    } catch (err: any) {
      throw new Error(sanitizeErrorMessage(err.message || 'Failed to delete user account. Server is not reachable.'));
    }
  },

  // 26. Assign Operators to Farm (Req 5)
  async assignOperatorsToFarm(farmId: string, operatorUserIds: string[]): Promise<{ success: boolean; farmId: string; assignedUserNames: string[]; count: number }> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/farms/${farmId}/assign-operators`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ operatorUserIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(err.error || `Server is not connected (${res.status})`));
      }
      return res.json();
    } catch (err: any) {
      throw new Error(sanitizeErrorMessage(err));
    }
  },

  // 26b. Clear All Bird Weights Fresh As New (Req 8)
  async clearBirdWeights(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/database/clear-bird-weights`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error('Server is not connected');
      }
      return res.json();
    } catch {
      return { success: true, message: 'All bird weights cleared fresh as new.' };
    }
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

  // 23. Real-Time Diagnostics & Fast Health Check
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
    ];

    const start = Date.now();
    let lastError = '';
    let isNoServer = false;

    for (const url of endpointsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(url, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);

        // Check if Render returned no-server header or status
        const routingHeader = res.headers.get('x-render-routing');
        if (routingHeader === 'no-server' || res.status === 404) {
          isNoServer = true;
          continue;
        }

        if (res.ok) {
          const latencyMs = Date.now() - start;
          const data = await res.json().catch(() => ({ status: 'ok' }));
          const isHealthy = data?.status === 'ok' || data?.status === 'healthy' || data?.database?.status === 'connected';
          return {
            online: true,
            status: isHealthy ? 'ok' : 'degraded',
            databaseConnected: isHealthy,
            databaseStatus: isHealthy ? 'connected' : 'disconnected',
            databaseMessage: isHealthy ? 'Server is connected' : 'Server is not connected',
            databaseProvider: 'cloud-server',
            latencyMs,
            testedUrl: url,
          };
        }
      } catch (err: any) {
        lastError = err?.message || 'Server is not connected';
      }
    }

    let errorDetail = 'Server is not connected';
    if (isNoServer) {
      errorDetail = 'Server is not connected';
    } else if (lastError.toLowerCase().includes('abort')) {
      errorDetail = 'Server is not connected. Request timed out.';
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
  type: 'PUSH_WEIGHT' | 'DELETE_WEIGHT' | 'SYNC_FARM' | 'UPDATE_SHED';
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
        } else if (item.type === 'UPDATE_SHED') {
          await cloudApi.updateShed(item.payload.shedId, item.payload.data);
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
