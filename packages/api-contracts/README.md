# Existing transport contracts

These files are the unchanged agenda, pattern, aggregate, connector, network and dependency schemas, plus the
error/retry implementation extracted from `client/src/contracts` in Backend
Independence Slice 01. The client paths remain compatibility re-exports. Backend
parity and resilience tests consume this independent source. This package is
TypeScript source for Vitest/Vite, not a new Node runtime API or a Gate B approval.

Product Truth Rulings govern semantic changes. Schema edits still require backend
wire parity, legacy consumer verification, and the applicable review evidence.
The extraction changes no vocabularies, validation, units, retry policy or error
identity. `packages/runtime-contracts` remains the existing runtime authority.
