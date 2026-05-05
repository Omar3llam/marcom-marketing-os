// ============================================================
// MARCOM / Lumi — Premium Theater Loader
// ============================================================
// Represents Lumi's AI actively processing and deciding.
// Premium glowing orb with magical pulsing effect.
// Used during THEATER state to signal intelligent analysis in progress.
// ============================================================

export default function LumiLoader({ label = 'Analyzing…', size = 'md' }) {
  const sizeClasses = {
    sm: 'w-12 h-12',
    md: 'w-16 h-16',
    lg: 'w-24 h-24',
  };

  const labelClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-6">
      {/* Premium Glowing Orb */}
      <div className="relative">
        {/* Outer glow layer (soft, slow pulse) */}
        <div
          className={`${sizeClasses[size]} absolute inset-0 rounded-full bg-gradient-to-br from-lumi-glow/30 to-accent-warm/20 blur-xl animate-pulse`}
          style={{ animation: 'pulse 3s ease-in-out infinite' }}
        />

        {/* Middle glow layer (medium speed) */}
        <div
          className={`${sizeClasses[size]} absolute inset-0 rounded-full bg-gradient-to-tr from-lumi-gold/40 to-transparent blur-lg`}
          style={{ animation: 'pulse 2s ease-in-out infinite', animationDelay: '0.1s' }}
        />

        {/* Core glowing sphere */}
        <div
          className={`${sizeClasses[size]} relative rounded-full bg-gradient-to-br from-lumi-glow via-lumi-gold to-accent-warm shadow-gold-glow`}
          style={{
            animation: 'pulse 1.5s ease-in-out infinite, glow-pulse 2s ease-in-out infinite',
            backdropFilter: 'blur(10px)',
          }}
        >
          {/* Inner light reflection */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/20 to-transparent opacity-40" />

          {/* Rotating sparkle effect */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.1) 25%, transparent 50%, rgba(255,255,255,0.1) 75%, transparent 100%)',
              animation: 'spin 3s linear infinite',
            }}
          />
        </div>
      </div>

      {/* Label */}
      <div className="text-center">
        <p className={`${labelClasses[size]} font-medium text-dark-base`}>{label}</p>
        <p className="text-xs text-dark-soft mt-1 animate-pulse">Intelligence Engine Active</p>
      </div>

      {/* Add custom animation keyframes via style tag */}
      <style>{`
        @keyframes glow-pulse {
          0%, 100% {
            box-shadow: 0 0 24px rgba(246, 201, 69, 0.2), 0 0 48px rgba(246, 201, 69, 0.1);
          }
          50% {
            box-shadow: 0 0 36px rgba(246, 201, 69, 0.4), 0 0 72px rgba(246, 201, 69, 0.2);
          }
        }
      `}</style>
    </div>
  );
}
