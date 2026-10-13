import React, { useState } from 'react';
import { Lock, User, Briefcase, ShieldCheck, AlertCircle } from 'lucide-react';
import { UserRole } from '../services/cloudSyncService';

export interface SharedLoginProps {
  onLoginSuccess: (user: { name: string; role: 'Admin' | 'Manager' | 'Supervisor' }) => void;
  onCancel?: () => void;
}

export const SharedLoginScreen: React.FC<SharedLoginProps> = ({ onLoginSuccess, onCancel }) => {
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('Supervisor');
  const [error, setError] = useState<string | null>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password.trim() || !name.trim()) {
      setError('Please enter the farm password and your name.');
      return;
    }

    // Verify shared environment password (fallback 'farm123')
    const validPassword = import.meta.env.VITE_FARM_SHARED_PASSWORD || 'farm123';
    if (password.trim() !== validPassword) {
      setError('Invalid Farm Password. Please check with your Admin.');
      return;
    }

    onLoginSuccess({ name: name.trim(), role });
  };

  return (
    <form onSubmit={handleLogin} className="space-y-3.5 p-5 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl text-slate-100">
      <div className="flex items-center gap-3 pb-2 border-b border-slate-800">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-black text-sm text-white">Shared Farm Authentication</h3>
          <p className="text-[11px] text-slate-400">Enter farm password & declare your identity</p>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs p-2.5 rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1">
          <Lock className="w-3 h-3 text-slate-500" />
          Farm Shared Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          placeholder="••••••••"
          required
          autoComplete="current-password"
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500 transition"
        />
        <span className="text-[10px] text-slate-500 mt-0.5 block">Shared by farm management (Default: farm123)</span>
      </div>

      <div>
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1">
          <User className="w-3 h-3 text-slate-500" />
          Your Full Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          placeholder="e.g. Suresh Kumar"
          required
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-emerald-500 transition"
        />
      </div>

      <div>
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1">
          <Briefcase className="w-3 h-3 text-slate-500" />
          Your Position / Role
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-emerald-500 transition cursor-pointer"
        >
          <option value="Admin">Admin (All Controls & Cloud Settings)</option>
          <option value="Manager">Manager (Read-Only Cloud Link)</option>
          <option value="Supervisor">Supervisor (Field Weighing & Drafts)</option>
        </select>
        <div className="mt-1 text-[10px] text-slate-400">
          {role === 'Admin' && '🟣 Full authority: Configure cloud endpoints, manage and delete records.'}
          {role === 'Manager' && '🔵 Operational oversight: Record flock data & multi-shed batches (Read-only cloud link).'}
          {role === 'Supervisor' && '🟢 Field operations: Line weight entry and draft staging (Read-only cloud link).'}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs shadow-md shadow-emerald-600/20 active:scale-95 transition cursor-pointer"
        >
          Enter Farm Workspace
        </button>
      </div>
    </form>
  );
};
