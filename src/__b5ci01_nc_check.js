// B5-CI-01 NC2b — TEMPORARY negative control. NEVER MERGE.
// An `@/` alias import. This is the narrowest violation that is UNIQUELY a
// `npm run check` failure: the syntax is valid (so `node --check` passes and a
// syntax error is not what is being measured), and eslint has no opinion on it
// (the unused binding is only a warning), but Node cannot resolve `@/` at
// runtime — which is exactly why check.js greps for it.
// Imported by nothing, so the backend suite is unaffected.
import prisma from '@/lib/prisma.js';

export const b5ci01CheckControl = () => prisma;
