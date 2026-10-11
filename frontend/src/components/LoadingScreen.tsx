import React, { useState, useEffect } from 'react';

interface LoadingScreenProps {
  message?: string;
  duration?: number;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  message = "Calibrating Shed & Line Uniformity...",
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
    }, 40);

    return () => clearInterval(timer);
  }, [duration]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50 px-6 select-none animate-in fade-in duration-200">
      {/* Background Ambient Radial Glow */}
      <div className="absolute w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

      {/* Emblem Container with Glowing Rings (Matching Provided Mockup) */}
      <div className="relative flex items-center justify-center w-56 h-56 mb-2">
        {/* Outer Orbiting Pulsing Ring */}
        <div className="absolute inset-0 rounded-full border-2 border-emerald-400/30 animate-pulse" />
        
        {/* Subtle Orbiting Dashed Ring */}
        <div className="absolute -inset-1 rounded-full border border-dashed border-emerald-500/40 animate-spin [animation-duration:14s]" />
        
        {/* Inner Glowing Badge with Rooster Emblem */}
        <div className="relative z-10 w-44 h-44 rounded-full bg-white border-2 border-emerald-300 shadow-2xl shadow-emerald-500/20 flex items-center justify-center overflow-hidden p-2">
          <img 
            src="/rooster-logo.jpg" 
            alt="Poultry Flock Pro Rooster Emblem" 
            className="w-36 h-36 object-contain select-none pointer-events-none drop-shadow-sm transition-transform duration-700 hover:scale-105"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
              const fallback = document.getElementById('rooster-svg-fallback');
              if (fallback) fallback.style.display = 'block';
            }}
          />

          {/* Inline Vector Graphic Fallback */}
          <svg 
            id="rooster-svg-fallback"
            className="w-24 h-24 text-emerald-600 hidden" 
            viewBox="0 0 64 64" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M28 14C27 11 29 8 32 8C34 8 35 10 35 12C37 10 40 10 41 12C43 12 45 14 44 17C43 19 41 20 39 21L37 20C36 17 32 15 28 14Z" fill="#EF4444" />
            <path d="M48 24L55 27L48 30Z" fill="#F59E0B" />
            <path d="M44 30C46 32 46 35 44 37C42 38 40 37 40 35L41 30H44Z" fill="#DC2626" />
            <path d="M34 18C38 18 45 20 46 25C47 30 43 35 41 38C38 42 36 47 35 52H25C25 45 27 38 29 32C30 28 30 22 34 18Z" fill="#0F172A" />
            <circle cx="41" cy="24" r="2" fill="#FFFFFF" />
            <circle cx="41" cy="24" r="1" fill="#000000" />
            <path d="M12 36C15 28 24 28 29 32C25 38 24 45 25 52C20 52 16 48 14 44C12 41 11 38 12 36Z" fill="#059669" />
            <path d="M18 40C22 35 30 36 33 42C31 46 28 50 24 52C20 50 18 45 18 40Z" fill="#047857" />
          </svg>
        </div>
      </div>

      {/* Primary Brand Title (Matching Layout) */}
      <h1 className="text-xl sm:text-2xl font-black tracking-widest text-slate-900 uppercase mt-4 text-center font-sans">
        POULTRY FLOCK PRO
      </h1>

      {/* Vibrant Subtitle */}
      <p className="text-[11px] sm:text-xs font-black tracking-widest text-emerald-600 uppercase mt-1 text-center font-sans">
        BODYWEIGHT & UNIFORMITY SUITE
      </p>

      {/* Subtle Divider Line */}
      <div className="w-20 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent my-3.5" />

      {/* Progress Track with Smooth 4-Second Fill */}
      <div className="w-64 sm:w-72 h-1.5 bg-slate-200 rounded-full overflow-hidden shadow-inner relative">
        <div 
          className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 rounded-full transition-all duration-75 ease-out shadow-xs"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Italic Dynamic Micro-Status Indicator */}
      <p className="text-xs font-medium text-slate-500 italic mt-3 text-center tracking-wide font-sans animate-pulse">
        {message}
      </p>

      {/* Cloudflare Edge Version Footnote */}
      <div className="absolute bottom-6 text-[10px] font-mono tracking-widest text-slate-400 uppercase">
        CLOUDFLARE EDGE ACTIVE • v2.4
      </div>
    </div>
  );
};
