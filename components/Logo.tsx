import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className = "w-8 h-8" }) => {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="hackerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
        <filter id="glow-sharp">
          <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect
        x="20"
        y="15"
        width="15"
        height="70"
        fill="#f1f5f9"
        className="drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
      />

      <path
        d="M85 15 L50 50 L85 85"
        stroke="url(#hackerGradient)"
        strokeWidth="14"
        strokeLinecap="square"
        strokeLinejoin="miter"
        fill="none"
        filter="url(#glow-sharp)"
      />

      <rect x="20" y="90" width="15" height="4" fill="#3b82f6" className="animate-pulse" />
      <rect x="42" y="47" width="6" height="6" fill="#0f172a" />
    </svg>
  );
};
