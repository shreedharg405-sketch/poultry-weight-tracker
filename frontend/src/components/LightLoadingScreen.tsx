import React, { useState, useEffect } from 'react';
import henLogo from '../assets/hen-logo.png';

interface LightLoadingScreenProps {
  message?: string;
  duration?: number;
}

export const LightLoadingScreen: React.FC<LightLoadingScreenProps> = ({
  message = "Calibrating Shed & Line Records...",
  duration = 2000
}) => {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);
      if (elapsed >= duration) {
        clearInterval(timer);
      }
    }, 30);

    return () => clearInterval(timer);
  }, [duration]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 via-white to-amber-50/30 px-6 select-none font-sans text-slate-800 animate-in fade-in duration-200">
      
      {/* Soft Ambient Radial Warm Glow */}
      <div className="absolute w-80 h-80 rounded-full bg-gradient-to-tr from-amber-200/40 via-rose-200/30 to-transparent blur-3xl pointer-events-none" />

      {/* Center Circular Badge */}
      <div className="relative flex items-center justify-center w-36 h-36 mb-6">
        
        {/* Subtle Outer Pulsing Ring */}
        <div className="absolute -inset-2 rounded-full border-2 border-dashed border-amber-400/40 animate-spin [animation-duration:12s]" />
        <div className="absolute -inset-0.5 rounded-full border border-rose-300/50 animate-ping opacity-30" />

        {/* Elevated Disc Card with Hen Illustration */}
        <div className="relative z-10 w-32 h-32 rounded-3xl bg-white border border-slate-100 shadow-xl shadow-amber-900/10 flex items-center justify-center p-3">
          <img 
            src={henLogo} 
            alt="Poultry Flock Pro Hen Emblem" 
            className="w-24 h-24 object-contain select-none pointer-events-none drop-shadow-sm transition-transform duration-700 hover:scale-105"
          />
        </div>
      </div>

      {/* Main Title Typography */}
      <h1 className="text-xl font-black tracking-widest text-slate-900 uppercase font-sans">
        POULTRY FLOCK PRO
      </h1>

      {/* Subtitle Accent */}
      <p className="text-xs font-bold tracking-wider text-amber-600 uppercase mt-1 font-sans">
        Bodyweight & Uniformity Suite
      </p>

      {/* Divider with Center Pill */}
      <div className="relative w-48 h-0.5 bg-slate-200 mt-4 mb-6 flex items-center justify-center">
        <div className="w-12 h-1 bg-gradient-to-r from-amber-500 to-rose-500 rounded-full" />
      </div>

      {/* Progress Track & Animated Runner */}
      <div className="w-56 h-1.5 bg-slate-200/80 rounded-full overflow-hidden shadow-inner relative">
        <div 
          className="h-full bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500 rounded-full transition-all duration-75 ease-out shadow-xs"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Status Caption */}
      <p className="text-xs font-medium text-slate-500 mt-3 animate-pulse text-center">
        {message}
      </p>

      {/* Footer Branding */}
      <div className="absolute bottom-6 text-[10px] font-semibold text-slate-400 tracking-wider uppercase">
        Enterprise Farm Edition • 2026
      </div>
    </div>
  );
};
