// ============================================================
// MARCOM / Lumi — Empty State (no campaigns)
// ============================================================
// Upload prompt when no campaign data exists
// ============================================================
import { Upload } from 'lucide-react';

export default function EmptyState({ onUpload }) {
  return (
    <div className="flex items-center justify-center min-h-[600px] p-8">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-lumi-accent/10 text-lumi-accent flex items-center justify-center">
          <Upload className="w-7 h-7" strokeWidth={1.5} />
        </div>
        <h2 className="decision-title text-dark-base mb-2">
          Upload a CSV to see your campaigns
        </h2>
        <p className="text-sm text-dark-soft leading-relaxed mb-6">
          Import your Meta Ads Manager export or sync live data to unlock AI-powered campaign analysis and automated recommendations.
        </p>
        <button
          onClick={onUpload}
          className="inline-flex items-center gap-2 px-5 py-3 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow"
        >
          <Upload className="w-4 h-4" strokeWidth={1.5} />
          Upload campaign data
        </button>
      </div>
    </div>
  );
}
