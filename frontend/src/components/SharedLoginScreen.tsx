import React, { useState } from 'react';
import { Lock, User, Briefcase, ShieldCheck, AlertCircle } from 'lucide-react';
import { UserRole } from '../services/cloudSyncService';

export interface SharedLoginProps {
  onLoginSuccess: (user: { name: string; role: UserRole }) => void;
  onCancel?: () => void;
  initialName?: string;
  initialRole?: UserRole;
}

export const SharedLoginScreen: React.FC<SharedLoginProps> = ({ 
  onLoginSuccess, 
  onCancel,
  initialName = '',
  initialRole = 'In-Charge'
}) => {
  const [password, setPassword] = useState('');
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState<UserRole>(initialRole);
  const [error, setError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 450);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validPassword = import.meta.env.VITE_FARM_SHARED_PASSWORD || 'farm123';

    if (!password || password.trim() !== validPassword) {
      setError('Please enter the login password correctly!');
      triggerShake();
      return;
    }

    if (!name.trim()) {
      setError('Please enter your name.');
      triggerShake();
      return;
    }

    onLoginSuccess({ name: name.trim(), role });
  };

  return (
    <form 
      onSubmit={handleLogin} 
      className={`space-y-3.5 p-5 bg-slate-900 rounded-2xl border shadow-xl text-slate-100 transition-all duration-200 ${
        isShaking 
          ? 'animate-shake border-rose-500/70 shadow-rose-950/40' 
          : 'border-slate-800'
      }`}
    >
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
          value={role === 'Admin' ? 'Manager' : (role === 'Incharge' ? 'In-Charge' : role)}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-emerald-500 transition cursor-pointer"
        >
          <option value="Manager">Manager (Full Management Privileges & Reports)</option>
          <option value="In-Charge">In-Charge (Field Weighing & Operational Submissions)</option>
        </select>
        <div className="mt-1 text-[10px] text-slate-400">
          {(role === 'Manager' || role === 'Admin') && '🔵 Full management authority: Master overview, batch controls, operator assignments & reports.'}
          {(role === 'In-Charge' || (role as string) === 'Incharge' || (role as string) === 'Supervisor') && '🟢 Field operations: Assigned farm weighing, draft staging & submissions.'}
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
