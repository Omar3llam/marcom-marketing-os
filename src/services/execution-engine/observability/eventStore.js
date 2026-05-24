// In-memory ring buffer for live graph events emitted during execution.
// Events are ephemeral: entries are evicted after TTL_MS or on explicit evict().
// For durable history, use ExecutionTransition rows in the database.

const TTL_MS     = 60 * 60 * 1000; // 1 hour
const PRUNE_EVERY = 50;             // lazy prune every N appends

// Map<executionId, { events: object[], lastAppendAt: number }>
const store = new Map();
let appendCount = 0;

export const eventStore = {
  append(executionId, event) {
    if (!store.has(executionId)) {
      store.set(executionId, { events: [], lastAppendAt: Date.now() });
    }
    const entry = store.get(executionId);
    entry.events.push(event);
    entry.lastAppendAt = Date.now();

    appendCount++;
    if (appendCount % PRUNE_EVERY === 0) _pruneExpired();
  },

  getEvents(executionId) {
    return [...(store.get(executionId)?.events ?? [])];
  },

  evict(executionId) {
    store.delete(executionId);
  },

  // Exposed for tests only — resets all state.
  _reset() {
    store.clear();
    appendCount = 0;
  },

  get _size() {
    return store.size;
  },
};

function _pruneExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of store) {
    if (entry.lastAppendAt < cutoff) store.delete(id);
  }
}
