// MarcomAI brand mark: gold ring + gold dot. Lumi remains the agent identity.
export function BrandMark({ size = 34, showWordmark = false }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: '50%',
          background: 'rgba(246,201,69,0.10)',
          boxShadow: 'var(--sh-gold-glow)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: '16%',
            borderRadius: '50%',
            border: '1.5px solid var(--c-gold-deep)',
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: size * 0.26,
            height: size * 0.26,
            transform: 'translate(-50%, -50%)',
            background: 'var(--c-gold)',
            borderRadius: '50%',
            boxShadow: '0 0 14px rgba(246,201,69,0.55)',
          }}
        />
      </span>
      {showWordmark && (
        <span
          className="font-display"
          style={{ fontWeight: 700, fontSize: 18, letterSpacing: 0, color: 'var(--c-text-base)' }}
        >
          Marcom<span style={{ color: 'var(--c-gold-deep)' }}>AI</span>
        </span>
      )}
    </span>
  );
}
