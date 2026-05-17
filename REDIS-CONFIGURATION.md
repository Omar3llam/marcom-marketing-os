# MARCOM Redis Configuration Guide

## Critical: Redis Eviction Policy

### TL;DR

**Redis MUST use `noeviction` policy in production.**

Current policy can be checked with:
```bash
redis-cli CONFIG GET maxmemory-policy
```

### Why This Matters

MARCOM uses Redis for **two purposes**:

1. **BullMQ Job Queues** (CRITICAL)
   - Action execution jobs
   - Observer jobs
   - Campaign synchronization
   
2. **Session Store** (non-critical)
   - Chat session caching
   - Has 7-day TTL

### The Problem

**Wrong Policy: `allkeys-lru`** (Render.com default)
- ❌ When memory limit is reached, Redis **silently evicts** keys
- ❌ BullMQ job data disappears without any error
- ❌ Queued actions never execute
- ❌ No audit trail, no retry, just silent failure
- ❌ Can corrupt BullMQ's internal state

**Correct Policy: `noeviction`**
- ✅ When memory limit is reached, Redis **rejects writes** with an error
- ✅ BullMQ jobs are never silently lost
- ✅ Errors are visible and actionable
- ✅ System fails loudly instead of silently

### How to Fix

#### On Render.com

1. Go to Dashboard → Redis instance → **Advanced** tab
2. Find **maxmemory-policy** setting
3. Change from `allkeys-lru` to `noeviction`
4. Click **Save Changes**
5. Restart the Redis instance

#### On AWS ElastiCache

1. Go to ElastiCache Console
2. Select your Redis cluster → **Modify**
3. Under **Parameter Group**, create a new parameter group if needed
4. Set `maxmemory-policy` = `noeviction`
5. Apply changes

#### On Self-Hosted Redis

Edit `redis.conf`:
```conf
maxmemory-policy noeviction
```

Then restart Redis:
```bash
sudo systemctl restart redis
```

#### Via redis-cli (Temporary)

```bash
redis-cli CONFIG SET maxmemory-policy noeviction
redis-cli CONFIG REWRITE  # Make it persistent
```

### Verification

**Startup Logs:**

When MARCOM backend starts, it validates the Redis policy:

✅ **Good:**
```json
{
  "level": "info",
  "msg": "[bullmq:redis] eviction policy validated ✓",
  "policy": "noeviction"
}
```

❌ **Bad:**
```json
{
  "level": "error",
  "msg": "❌ [bullmq:redis] DANGEROUS EVICTION POLICY DETECTED",
  "current_policy": "allkeys-lru",
  "required_policy": "noeviction",
  "impact": "BullMQ job data can be silently evicted under memory pressure",
  "fix": "Set maxmemory-policy=noeviction in Redis config"
}
```

**Manual Check:**

```bash
# Connect to your Redis instance
redis-cli -u $REDIS_URL

# Check current policy
CONFIG GET maxmemory-policy

# Should return:
# 1) "maxmemory-policy"
# 2) "noeviction"
```

### What Happens If Wrong Policy Is Used?

**Development:**
- Warning logged to console
- Application continues (graceful degradation)

**Production:**
- **FATAL error logged**
- Application logs contain clear diagnostic
- Optionally: application exits immediately (currently disabled)

To enable hard failure in production (recommended for mission-critical deployments), uncomment this line in `src/queues/connection.js`:

```javascript
if (isProd) {
  logger.fatal('[bullmq:redis] FATAL: Production Redis has wrong eviction policy. Jobs will be lost.');
  process.exit(1);  // ← Uncomment this line
}
```

### Memory Planning

With `noeviction` policy, Redis will reject writes when memory is full. Plan accordingly:

#### Estimate Memory Usage

**BullMQ Jobs:**
- Average job: ~1 KB
- 10,000 jobs: ~10 MB
- Completed jobs retained: 1,000 (configurable)
- Estimated: **20 MB** for job queues

**Session Store:**
- Average session: ~5 KB
- Max sessions with 7-day TTL: depends on active users
- 1,000 active users: **5 MB**

**Total Estimate:** 50 MB (with safety margin)

#### Render.com Plans

- **Starter Plan**: 25 MB max memory (⚠️ too small for production)
- **Standard Plan**: 100 MB+ (✅ sufficient)
- **Pro Plan**: 1 GB+ (✅ recommended)

#### What If Memory Is Full?

With `noeviction`:
1. Redis rejects new writes with `OOM` error
2. BullMQ logs error: "Cannot enqueue job"
3. Application returns 503 to user with actionable message
4. **No silent data loss**

### Monitoring

Add monitoring for:

1. **Redis Memory Usage**
   ```bash
   redis-cli INFO memory | grep used_memory_human
   ```

2. **Redis Evictions** (should always be 0)
   ```bash
   redis-cli INFO stats | grep evicted_keys
   # evicted_keys:0 ← Good
   ```

3. **BullMQ Queue Length**
   ```bash
   redis-cli LLEN bull:lumi:action-queue:wait
   ```

### Session Store Trade-off

**Question:** If Redis is full, can we afford to lose session data?

**Answer:** Yes, with acceptable UX degradation:
- Sessions are already cached in Redis (not source of truth)
- Session loss → user sees "session expired" → re-login
- NOT catastrophic (unlike job loss)

**But:** With `noeviction`, sessions are protected too. Win-win.

### Alternative: Separate Redis Instances

If you need different policies for different use cases:

1. **Primary Redis** (BullMQ): `noeviction` policy
2. **Cache Redis** (Sessions): `allkeys-lru` policy

Set in Render.com:
- Create two Redis services
- Configure different policies
- Update `REDIS_URL` for BullMQ
- Add `REDIS_CACHE_URL` for sessions

Update `src/services/session-store.js`:
```javascript
const cacheUrl = process.env.REDIS_CACHE_URL || process.env.REDIS_URL;
```

## Summary

| Aspect | Wrong (`allkeys-lru`) | Correct (`noeviction`) |
|--------|----------------------|----------------------|
| **Job Safety** | ❌ Jobs silently lost | ✅ Jobs never lost |
| **Error Handling** | ❌ Silent failure | ✅ Loud failure |
| **Memory Full** | Evicts old data | Rejects new writes |
| **Production Ready** | ❌ NO | ✅ YES |
| **Monitoring** | Hard (silent) | Easy (errors logged) |
| **Rollback** | Impossible | Possible (jobs queued) |

**Bottom Line:** Always use `noeviction` for BullMQ. It's the only production-safe option.
