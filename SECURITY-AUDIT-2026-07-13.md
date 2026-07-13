# MARCOM Security Audit — July 13, 2026 (Wave 6)

## Executive Summary

**Audit Date:** 2026-07-13
**Context:** Wave 6 dependency remediation.
**npm audit before Wave 6:** 9 vulnerabilities (8 moderate, 1 high)
**npm audit after Wave 6 (PR #213):** 2 vulnerabilities (1 moderate, 1 high)
**Fixed:** 8 vulnerabilities — the entire transitive `uuid` cluster, via an `overrides` entry (PR #213, `uuid@^11.1.1`)
**Accepted Risk:** 2 package-level vulnerabilities (4 advisories) — the **dev-only `vite`/`esbuild` chain**

The 8 moderate advisories cleared in PR #213 are documented in that PR. This audit documents the **acceptance** of the 2 remaining advisories, which cannot be fixed without a major `vite` upgrade (out of Wave 6's patch-only scope) and carry **zero production exposure**.

## Vulnerabilities Accepted (Require a Major `vite` Upgrade ❌)

Both remaining `npm audit` entries trace to the frontend build toolchain (`client/`). `vite` and its bundler `esbuild` are **`devDependencies`** — they run only at build/dev time and are **not part of the production bundle** (`vite build` emits static JS/CSS; neither package ships to users or runs on the server). Every advisory below is a **dev-server-time** issue affecting a developer running `vite dev`, not the deployed SaaS.

### 1. esbuild dev-server request (MODERATE) ❌ ACCEPTED RISK
**CVE:** GHSA-67mh-4wv8-2f99
**Package:** `esbuild@0.21.5` (transitive, bundled by `vite@5.4.21`)
**Vulnerable range:** `<=0.24.2`
**Impact:** A running esbuild dev server accepts cross-origin requests, letting any website the developer visits read dev-server responses.
**Exploitability:** Low — requires the developer to run the dev server *and* browse to a malicious page in the same session; no production surface.
**MARCOM Usage:** Build/dev tooling only (`client` devDependency). Not in the production bundle, not on the server.
**Fix Available:** `vite@8.1.4` (isSemVerMajor) — pulls `esbuild@0.25+`. No `esbuild` fix exists within the `vite@5.x` line (`vite@5.4.x` pins `esbuild@^0.21`).
**Why Skipped:** Fix requires a two-major `vite` bump (5 → 8), which is out of scope for the Wave 6 patch-only program and needs its own verified PR (plugin peer-matrix + `vitest` coupling + build/dev/test).

### 2. vite dev-server advisories (HIGH, aggregate) ❌ ACCEPTED RISK
**Package:** `vite@5.4.21` (`client` devDependency)
**Vulnerable range:** `<=6.4.2` (first patched in `vite@6.4.3`)
**Advisories:**
  - **GHSA-4w7w-66w2-5vf9** — Path traversal in optimized-deps `.map` handling (dev server)
  - **GHSA-fx2h-pf6j-xcff** — `server.fs.deny` bypass via Windows alternate paths (dev server)
  - **GHSA-v6wh-96g9-6wx3** — `launch-editor` NTLMv2 hash disclosure via UNC path on Windows (error-overlay "open in editor" path)
  - (also inherits the `esbuild` advisory above via the toolchain)
**Impact:** All are exploitable only against a **running `vite dev` server** — reading files the dev server would otherwise deny, or leaking an NTLM hash when the error overlay opens a UNC path on Windows.
**Exploitability:** Low — dev-time only; no production/server surface.
**MARCOM Usage:** Build/dev tooling only. Not in the production bundle.
**Fix Available:** `vite@6.4.3+` (npm's clean path: `vite@8.1.4`, isSemVerMajor). **No patched release exists in the `vite@5.x` line** — the vulnerable range spans all of 5.x.
**Why Skipped:** Same as above — only the major `vite` bump clears these, which is a separate, properly-verified PR.

## Production Risk Assessment

| Advisory | Pkg | Severity | Where it runs | Prod exposure | Fix | Status |
|---|---|---|---|---|---|---|
| GHSA-67mh-4wv8-2f99 esbuild dev CORS | esbuild | MODERATE | `vite dev` only | NONE (devDependency) | vite 8 (major) | ❌ ACCEPTED |
| GHSA-4w7w-66w2-5vf9 path traversal | vite | HIGH | `vite dev` only | NONE (devDependency) | vite 6.4.3+ | ❌ ACCEPTED |
| GHSA-fx2h-pf6j-xcff fs.deny bypass | vite | HIGH | `vite dev` (Windows) | NONE (devDependency) | vite 6.4.3+ | ❌ ACCEPTED |
| GHSA-v6wh-96g9-6wx3 launch-editor NTLM | vite→launch-editor | HIGH | error overlay (Windows) | NONE (devDependency) | vite 6.4.3+ | ❌ ACCEPTED |

**Net production risk: none.** None of these packages execute in production or on the server; the production artifact is static output produced by `vite build`.

## Why not a `vite@5.x` patch bump?

Investigated during Wave 6 PR-2 (patch-only, stay within `vite@5.x`):
- Installed `vite` is already **`5.4.21`** — the **latest 5.x** (the `^5.4.11` pin already caret-resolves to it; the lockfile is on it).
- Every advisory's vulnerable range **encompasses all of `5.x`**; every fix lands in `6.4.3+` / `esbuild 0.25+`.
- Therefore **no `5.x` release clears any of these**. A patch-only bump was a dead end and was **not** taken (it would have changed only the cosmetic package.json floor and patched nothing).

## Validation

```bash
# npm audit (root workspace, covers client)
# Before Wave 6:  9 vulnerabilities (8 moderate, 1 high)
# After PR #213:  2 vulnerabilities (1 moderate, 1 high)   ← this document accepts these 2
npm run check      # ✅ PASSED
npm run lint       # ✅ PASSED (0 errors)
```

No dependency change is made by this document — it records an accepted risk only.

## Reassessment

- **Trigger:** The dedicated **`vite` major-upgrade PR** (5 → 6.4.3+ / 8.x). That single PR clears all 4 advisories at once; there is no interim partial fix.
- **Until then:** These are tracked, dev-only, zero-production-exposure risks. Re-run `npm audit` each dependency wave and confirm the set has not grown or gained a production surface.
- **Owner action:** Do not merge a "security patch" that only bumps the `vite@5.x` floor — it patches nothing. The fix is the major bump or nothing.

## Sign-off

**Audit Performed By:** Claude Opus 4.8 (Wave 6 dependency remediation)
**Risk Acceptance:** 2 package-level advisories (4 CVEs), all dev-only, zero production exposure
**Deployment Approval:** ✅ APPROVED (with documented risk acceptance)

---

**Last Updated:** 2026-07-13
**Supersedes prior snapshot:** `SECURITY-AUDIT-2026-05-17.md` (point-in-time; its accepted `firebase-admin`/`nodemailer` items have since moved on — `firebase-admin@14`, `nodemailer@9`)
**Next Review:** at the `vite` major-upgrade PR, or the next dependency wave
