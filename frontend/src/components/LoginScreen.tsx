import React, { useState } from 'react';
import { User, Lock, Eye, EyeOff, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { cloudApi, AppUser } from '../services/cloudSyncService';
import roosterLogo from '../assets/rooster-logo.jpg';

export interface LoginScreenProps {
  onLoginSuccess: (user: AppUser, token: string) => void;
  onCancel?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, onCancel }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 450);
  };

  const executeLogin = async (targetUsername: string, targetPassword: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const response = await cloudApi.login({ username: targetUsername.trim(), password: targetPassword });
      onLoginSuccess(response.user, response.token);
    } catch (err: any) {
      setError(err.message || 'Invalid username or password.');
      triggerShake();
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Please enter your username.');
      triggerShake();
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      triggerShake();
      return;
    }
    await executeLogin(trimmedUsername, password);
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center px-4 py-8 select-none min-h-[85vh]">
      <div className="w-full max-w-md mx-auto">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-slate-900 border-2 border-emerald-500/40 shadow-xl shadow-emerald-950/30 mb-3 overflow-hidden p-2">
            <img 
              src={roosterLogo} 
              alt="Poultry Flock Pro" 
              className="w-full h-full object-contain pointer-events-none drop-shadow-sm"
            />
          </div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-wider uppercase font-sans">
            POULTRY FLOCK PRO
          </h1>
          <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest mt-0.5">
            Authorized Field & Executive Portal
          </p>
        </div>

        {/* Main Single Common Login Card */}
        <form
          onSubmit={handleLogin}
          className={`p-6 bg-slate-900 rounded-3xl border text-slate-100 shadow-2xl transition-all duration-200 ${
            isShaking 
              ? 'animate-shake border-rose-500/70 shadow-rose-950/40' 
              : 'border-slate-800'
          }`}
        >
          <div className="flex items-center gap-2.5 pb-3 mb-4 border-b border-slate-800/80">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-sm font-black text-white">Sign In to Workspace</h2>
              <p className="text-[11px] text-slate-400">Enter your credentials to open your dashboard</p>
            </div>
          </div>

          {/* Error Alert Banner */}
          {error && (
            <div className="mb-4 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs p-3 rounded-2xl flex items-center gap-2 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span className="font-semibold text-[11px]">{error}</span>
            </div>
          )}

          {/* Field 1: Username */}
          <div className="mb-3.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-500" />
              <span>Username</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(null); }}
                placeholder="Enter your assigned username..."
                required
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-2xl px-3.5 py-3 text-xs text-white font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition placeholder:text-slate-600 shadow-inner"
              />
            </div>
          </div>

          {/* Field 2: Password with Show/Hide toggle */}
          <div className="mb-5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>Password</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="••••••••••••"
                required
                autoComplete="current-password"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-2xl pl-3.5 pr-11 py-3 text-xs text-white font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition placeholder:text-slate-600 shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-emerald-400 transition cursor-pointer"
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4 text-slate-400" />
                ) : (
                  <Eye className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {/* Login Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-60 text-white font-black py-3.5 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying Credentials...</span>
              </>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="w-full mt-2 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-300 font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center transition cursor-pointer"
            >
              Cancel
            </button>
          )}

          {/* Operational Security Note */}
          <p className="mt-4 text-[10px] text-slate-500 text-center">
            Secure Role-Based Authentication
          </p>
        </form>
      </div>
    </div>
  );
};
