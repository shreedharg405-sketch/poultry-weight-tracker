import React from 'react';
import { 
  Volume2, 
  VolumeX, 
  ShieldCheck, 
  Wifi, 
  WifiOff, 
  FileText, 
  Home, 
  PlusCircle, 
  Scale, 
  Smartphone,
  Sun,
  Moon,
  FileSpreadsheet
} from 'lucide-react';
import { soundEffects } from '../services/audioFeedback';

interface NavbarProps {
  activeTab: 'excel' | 'shed' | 'tally' | 'paper' | 'history' | 'mobile';
  setActiveTab: (tab: 'excel' | 'shed' | 'tally' | 'paper' | 'history' | 'mobile') => void;
  onOpenShedSetup: () => void;
  isBackendConnected: boolean;
  soundEnabled: boolean;
  setSoundEnabled: (val: boolean) => void;
  isMobileView: boolean;
  setIsMobileView: (val: boolean) => void;
  theme?: 'light' | 'dark';
  setTheme?: (theme: 'light' | 'dark') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenShedSetup,
  isBackendConnected,
  soundEnabled,
  setSoundEnabled,
  isMobileView,
  setIsMobileView,
  theme = 'light',
  setTheme,
}) => {
  const isLight = theme === 'light';

  const toggleSound = () => {
    soundEffects.enabled = !soundEnabled;
    setSoundEnabled(!soundEnabled);
  };

  const toggleTheme = () => {
    if (setTheme) {
      setTheme(isLight ? 'dark' : 'light');
    }
  };

  return (
    <header className={`sticky top-0 z-40 transition-colors backdrop-blur-md border-b shadow-sm no-print ${
      isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/95 border-slate-800 text-white'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branding */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-md font-black text-xl text-white">
              🐔
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`font-extrabold text-lg tracking-tight ${
                  isLight 
                    ? 'text-slate-900' 
                    : 'bg-gradient-to-r from-emerald-400 via-teal-200 to-amber-300 bg-clip-text text-transparent'
                }`}>
                  POULTRY SYNC
                </span>
                <span className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold border ${
                  isLight 
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                }`}>
                  Shed Edition
                </span>
              </div>
              <p className={`text-xs hidden sm:block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                B.wt Excel Replica & Multi-Pen Uniformity System
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setActiveTab('excel')}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'excel'
                  ? isLight 
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-sm' 
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : isLight 
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4 text-amber-500" />
              <span>B.wt Excel & Cons</span>
            </button>
            <button
              onClick={() => setActiveTab('shed')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'shed'
                  ? isLight 
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-xs' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : isLight 
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Home className="w-4 h-4" />
              <span>Shed Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('tally')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'tally'
                  ? isLight 
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-xs' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : isLight 
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Scale className="w-4 h-4" />
              <span>Pen Tally</span>
            </button>

            <button
              onClick={() => setActiveTab('paper')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'paper'
                  ? isLight 
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-xs' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : isLight 
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span className="hidden md:inline">Paper Sheet</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'history'
                  ? isLight 
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-xs' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : isLight 
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span className="hidden md:inline">History</span>
            </button>
          </nav>

          {/* Action Tools */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Mobile View Switcher */}
            <button
              onClick={() => setIsMobileView(!isMobileView)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border ${
                isMobileView
                  ? isLight 
                    ? 'bg-sky-50 text-sky-800 border-sky-300 shadow-xs' 
                    : 'bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sm'
                  : isLight 
                    ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300' 
                    : 'bg-slate-850 text-slate-300 hover:text-white border-slate-700 hover:bg-slate-800'
              }`}
              title={isMobileView ? 'Switch to Desktop Matrix' : 'Switch to Mobile Field View'}
            >
              <Smartphone className="w-3.5 h-3.5 text-sky-600" />
              <span>{isMobileView ? 'Desktop' : 'Mobile View'}</span>
            </button>

            {/* Light / Dark Mode Toggle Button */}
            {setTheme && (
              <button
                onClick={toggleTheme}
                title={isLight ? 'Switch to Dark Mode' : 'Switch to Daylight Light Mode'}
                className={`p-2 rounded-lg transition border ${
                  isLight 
                    ? 'bg-slate-100 hover:bg-slate-200 text-amber-600 border-slate-300' 
                    : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border-slate-700'
                }`}
              >
                {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </button>
            )}

            {/* Shed Setup Action */}
            <button
              onClick={onOpenShedSetup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-sm"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Shed Setup</span>
            </button>

            {/* Sound Toggle */}
            <button
              onClick={toggleSound}
              title={soundEnabled ? 'Tally audio enabled' : 'Tally audio muted'}
              className={`p-2 rounded-lg transition border ${
                isLight 
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-600" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* API Status Badge */}
            <div
              title={isBackendConnected ? 'Connected to Render / Express API' : 'Operating in offline local cache mode'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                isBackendConnected
                  ? isLight 
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                    : 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                  : isLight 
                    ? 'bg-amber-50 text-amber-800 border-amber-300' 
                    : 'bg-amber-950/60 text-amber-300 border-amber-500/30'
              }`}
            >
              {isBackendConnected ? (
                <>
                  <Wifi className="w-3 h-3 text-emerald-600" />
                  <span className="hidden xl:inline">Online API</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-amber-600" />
                  <span className="hidden xl:inline">Offline</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
