# ADR-001: Firebase Auth over Clerk

**Status:** ✅ Accepted  
**Date:** Sprint 4 (v4.1)  
**Deciders:** Lead engineer + stakeholder review

## Context

MARCOM v1-v3 used Clerk as the authentication provider. While Clerk provided excellent DX (developer experience) with ready-made UI components and session management, we encountered several issues:

1. **Vendor lock-in risk**: Clerk-specific APIs and session tokens made it difficult to migrate
2. **MENA region support**: Clerk's infrastructure had latency issues for Middle East users
3. **Cost at scale**: Clerk pricing scales with MAU (monthly active users), becoming expensive as we approached 1000+ users
4. **Firebase integration**: We already used Firebase for real-time features, creating redundant auth infrastructure

The question: **Continue with Clerk or migrate to Firebase Auth?**

## Decision

**Migrate to Firebase Authentication** for all user sign-in, session management, and JWT verification.

Key changes:
- Replace `@clerk/clerk-react` with Firebase SDK (`firebase`, `firebase-admin`)
- Replace `clerkAuthMiddleware` with `firebaseAuthMiddleware` in backend
- Keep the `clerkId` column in Prisma schema but repurpose it to store Firebase `uid`
- Migrate all existing users to Firebase (preserve their IDs to avoid breaking foreign keys)

## Rationale

### Why Firebase over Clerk?

1. **Already in the stack**: We were using Firebase Realtime Database for live campaign updates — consolidating auth eliminates one vendor
2. **Global edge network**: Firebase has edge nodes in Dubai, Riyadh, Cairo — much lower latency for MENA users
3. **Predictable pricing**: Firebase Auth is free up to 50K MAU, then $0.0055/user — significantly cheaper than Clerk at scale
4. **Standard JWT**: Firebase ID tokens are standard JWTs that can be verified with `firebase-admin` SDK or any JWT library
5. **No UI lock-in**: Unlike Clerk's opinionated UI components, Firebase lets us build custom auth flows that match MARCOM's design system

### Why NOT Clerk?

- Clerk's session management was excellent, but we only used 20% of its features (we didn't need org management, user impersonation, or magic links)
- Clerk's pricing would hit ~$300/month at 1000 MAU (our projected Q3 scale), vs. Firebase's $5.50/month
- Migrating FROM Clerk is harder the longer we wait (more users, more integrations)

## Consequences

### Positive

✅ **Cost savings**: $300/mo → $5.50/mo at 1000 MAU  
✅ **MENA latency**: Auth requests drop from ~400ms to ~80ms for Dubai users  
✅ **Consolidation**: One less vendor to manage (Firebase handles auth + realtime)  
✅ **Standard tokens**: JWTs work with any backend framework, not just Clerk SDK  
✅ **Custom UI**: Full control over sign-in flow (no Clerk branding, no opinionated modals)

### Negative

❌ **Migration effort**: Migrating 200+ existing users took 1 sprint  
❌ **Lost Clerk UI**: Had to build our own sign-in/sign-up components (added ~300 LOC)  
❌ **Lost session hooks**: Clerk's `useUser()` hook was replaced with custom `AuthContext`  
❌ **Breaking change**: All users had to re-authenticate after migration (announced 1 week in advance)  
❌ **Backend refactor**: 12 routes needed `clerkAuthMiddleware` → `firebaseAuthMiddleware`

### Migration debt repaid

We kept the `clerkId` column name in the database to avoid:
- Breaking 15+ foreign key relationships
- Rewriting 30+ Prisma queries that reference `user.clerkId`
- Renaming migration scripts and risk of data loss

The column is now semantically incorrect (it stores Firebase `uid`, not Clerk ID), but the cost of renaming it exceeded the value. Future engineers: **do NOT rename `clerkId` to `firebaseUid`** — the entire codebase would break.

## Evidence in Code

**Firebase middleware (canonical):**
```
src/middleware/firebaseAuth.js
  → Verifies Firebase ID tokens
  → Populates req.user with { uid, email, workspaceId }
```

**Deprecated Clerk middleware (still exists but unused):**
```
src/middleware/clerkAuth.js
  → Still imported by src/routes/auth/meta.js (OAuth route)
  → Will be removed when OAuth is refactored to Firebase
```

**Prisma schema:**
```
prisma/schema.prisma
  model User {
    clerkId String @unique  // ← Firebase uid stored here
  }
```

**Frontend auth context:**
```
client/src/context/AuthContext.jsx
  → Uses firebase.auth().currentUser
  → Calls getIdToken() to generate JWT for API calls
```

**API client:**
```
client/src/lib/api.js
  → Axios interceptor attaches Firebase JWT to all requests
  → Header: Authorization: Bearer <firebase-id-token>
```

## Alternatives Considered

### 1. NextAuth.js
- **Pro**: Open-source, very flexible
- **Con**: Requires Next.js backend (we use Express), complex session management

### 2. Auth0
- **Pro**: Enterprise-grade, lots of integrations
- **Con**: Even more expensive than Clerk ($240/mo for 1000 MAU), overkill for our use case

### 3. Roll our own (bcrypt + JWT)
- **Pro**: Full control, zero vendor cost
- **Con**: Security risk (password resets, MFA, rate limiting all need custom implementation), high maintenance burden

### 4. Stay with Clerk
- **Pro**: No migration effort, familiar DX
- **Con**: Cost would hit $3600/year at 1000 MAU, MENA latency remains poor

## Rollback Plan

If Firebase Auth proves unreliable, we can rollback to Clerk in ~2 sprints:
1. Re-enable `clerkAuthMiddleware` in backend
2. Restore Clerk SDK in frontend (`npm install @clerk/clerk-react`)
3. Migrate Firebase UIDs back to Clerk IDs (1:1 mapping preserved in audit log)
4. User re-authentication required (same as forward migration)

**Likelihood of rollback:** <5% — Firebase Auth is a mature product (10+ years in production at Google scale).

## Related ADRs

- None (this is the first auth decision for MARCOM)
