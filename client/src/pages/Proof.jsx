// FE-02 — the default export is gone with the page. `/app/intelligence/proof`
// no longer renders a surface: it redirects to /app/memory, where the proof
// reading composes as `ProofReading` (B7 Ruling 2 — one object, two readings).
// These two named re-exports stay because they have live consumers.
export { ProofSummary, ProofView } from '@/features/intelligence/proof/ProofView.jsx';
