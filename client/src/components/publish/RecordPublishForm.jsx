// ============================================================
// RecordPublishForm — record a manual Meta publish (Option B)
// ============================================================
// Surfaced on an APPROVED artifact. After a human publishes the ad manually
// in Meta Ads Manager (using copy/briefs from this artifact), they enter the
// real Meta IDs here to close the attribution link (PublishedCreative row).
//
// This is NOT one-click publishing — the app does not create the ad. It
// records an external action that already happened. Self-gating: renders
// nothing unless the artifact has cleared approval (COMPLETED + APPROVED),
// mirroring the codebase's approval-status gating pattern.
// ============================================================
import { useState } from 'react';
import { Send, CheckCircle, AlertCircle } from 'lucide-react';
import { Text } from '../primitives/core/Text.jsx';
import { useRecordPublish } from '../../hooks/useRecordPublish.js';
import { cn } from '../../lib/utils';

/** True only when the artifact has cleared human approval. */
export function isApproved(artifact) {
  return (
    artifact?.approval?.status === 'COMPLETED' &&
    artifact?.approval?.decision === 'APPROVED'
  );
}

const FIELDS = [
  { name: 'metaAdId', label: 'Meta ad ID', required: true, placeholder: 'e.g. 120200000000000000' },
  { name: 'metaCampaignId', label: 'Meta campaign ID', required: true, placeholder: 'e.g. 230100000000000000' },
  { name: 'metaAdsetId', label: 'Meta ad set ID', required: false, placeholder: 'optional' },
  { name: 'adName', label: 'Ad name', required: false, placeholder: 'optional' },
];

/**
 * @param {Object} props
 * @param {Object} props.artifact - artifact with approval status
 * @param {Function} [props.onRecorded] - called with the created PublishedCreative
 */
export function RecordPublishForm({ artifact, onRecorded }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ metaAdId: '', metaCampaignId: '', metaAdsetId: '', adName: '' });
  const [missing, setMissing] = useState(false);

  const { recordPublish, submitting, error, published, reset } = useRecordPublish({ onSuccess: onRecorded });

  // Gate: only approved artifacts can be recorded as published.
  if (!isApproved(artifact)) return null;

  const setField = (name) => (e) => setValues((prev) => ({ ...prev, [name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Client-side required check (backend re-validates and is source of truth).
    if (!values.metaAdId.trim() || !values.metaCampaignId.trim()) {
      setMissing(true);
      return;
    }
    setMissing(false);
    try {
      await recordPublish(artifact.id, values);
    } catch {
      // Error surfaced via `error` from the hook; keep the form open to fix IDs.
    }
  };

  // ── Recorded confirmation ─────────────────────────────────
  if (published) {
    return (
      <div className="mt-4 p-3 bg-signal-scale/10 border border-signal-scale/20 rounded">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-signal-scale" />
          <Text variant="data" intent="success" className="font-semibold">
            Publish recorded
          </Text>
        </div>
        <Text variant="body" intent="secondary" size="sm" className="mt-1">
          Linked to Meta ad {published.metaAdId}. Performance will attribute back to this artifact.
        </Text>
      </div>
    );
  }

  // ── Collapsed call-to-action ──────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-lumi-gold/30 text-lumi-gold text-sm font-medium hover:bg-lumi-gold/10 transition-colors"
      >
        <Send className="h-4 w-4" />
        Record Meta publish
      </button>
    );
  }

  // ── Entry form ────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="mt-4 p-4 bg-surface-dark/20 border border-surface-border rounded-lg space-y-3">
      <div>
        <Text variant="label" intent="primary">
          Record Meta publish
        </Text>
        <Text variant="body" intent="muted" size="sm" className="mt-1">
          Already published this ad in Meta Ads Manager? Enter its real IDs to link performance back to this artifact. This does not create the ad.
        </Text>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FIELDS.map(({ name, label, required, placeholder }) => (
          <div key={name}>
            <label htmlFor={`publish-${name}`} className="block text-sm font-medium text-dark-soft mb-1">
              {label} {required && <span className="text-signal-kill">*</span>}
            </label>
            <input
              id={`publish-${name}`}
              type="text"
              value={values[name]}
              onChange={setField(name)}
              placeholder={placeholder}
              className="w-full px-3 py-2 bg-surface-card border border-surface-border rounded text-dark-base placeholder:text-dark-subtle focus:outline-none focus:ring-2 focus:ring-lumi-gold/50"
            />
          </div>
        ))}
      </div>

      {/* Client-side required-field message */}
      {missing && (
        <div className="flex items-center gap-2 text-signal-kill text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>Meta ad ID and campaign ID are required.</span>
        </div>
      )}

      {/* Mapped server error (malformed IDs, already-published, permission) */}
      {error && (
        <div className="flex items-center gap-2 text-signal-kill text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className={cn(
            'px-4 py-2 rounded-lg font-medium transition-all',
            submitting
              ? 'bg-surface-dark text-dark-muted cursor-not-allowed'
              : 'bg-lumi-gold text-surface-dark hover:bg-lumi-gold/90 active:scale-95'
          )}
        >
          {submitting ? 'Recording...' : 'Record publish'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setMissing(false); reset(); }}
          className="px-4 py-2 rounded-lg font-medium text-dark-soft hover:text-dark-base hover:bg-surface-dark/50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
