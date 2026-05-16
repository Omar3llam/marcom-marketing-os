# Architecture Decision Records

This directory captures WHY major architectural decisions were made in MARCOM.

> **ADRs are for humans and AI agents** — so nobody silently undoes a
> decision that had a good reason, and nobody asks "why is it like this?"

## When to write an ADR

Write one when the decision is:
- Hard to reverse (auth provider, DB, state management pattern)
- Confusing without context (why two orchestrators? why clerkId in DB?)
- Likely to be questioned by a future engineer or AI session

## When NOT to write an ADR

Do NOT write one for:
- Adding a component, endpoint, or page
- Styling or copy changes
- Refactoring within an existing pattern
- Anything that can be reversed in one PR

## Status labels

| Status | Meaning |
|---|---|
| ✅ Accepted | Decision is in effect. Do not change without a new ADR. |
| ⚠️ Superseded | Replaced by a newer decision. Old ADR kept for history. |
| 🔄 Proposed | Under discussion — not yet final. |

---

## Index

| # | Decision | Status | Date |
|---|---|---|---|
| [ADR-001](ADR-001-firebase-over-clerk.md) | Firebase Auth over Clerk | ✅ Accepted | Sprint 4 |
| [ADR-002](ADR-002-postgres-over-airtable.md) | PostgreSQL + Prisma over Airtable | ✅ Accepted | Sprint 3 |
| [ADR-003](ADR-003-dual-agent-architecture.md) | Dual-agent orchestration (Claude + GPT) | ✅ Accepted | Sprint 5 |
| [ADR-004](ADR-004-fsm-ui-pattern.md) | FSM for decision UI state | ✅ Accepted | Sprint 4 |
| [ADR-005](ADR-005-bullmq-execution-layer.md) | BullMQ for async Meta execution | ✅ Accepted | Sprint 5 |

---

## Template

When creating a new ADR, use this structure:

```markdown
# ADR-XXX: [Title]

**Status:** ✅ Accepted / ⚠️ Superseded / 🔄 Proposed  
**Date:** Sprint N  
**Deciders:** [who made the call]

## Context

What problem are we solving? What constraints exist?

## Decision

What did we decide to do?

## Rationale

Why this approach over alternatives?

## Consequences

### Positive
- What improves

### Negative
- What tradeoffs we accepted

## Evidence in Code
- File references that prove this decision is in effect
```
