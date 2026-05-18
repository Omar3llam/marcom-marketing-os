# 🚀 Deploy Design System v2.0 — Action Plan

**Status:** ✅ Ready for deployment  
**Commit:** `9f80d62` (committed locally)  
**Risk:** Minimal (non-breaking, CSS only)

---

## ⚡ Quick Deploy (Next 3 Steps)

### Step 1: Push to Remote (30 seconds)

```bash
cd g:\MARCOM\marketing-os-v3
git push origin master
```

**Expected:** Remote updated with design system refactor

---

### Step 2: Deploy to Staging (3-5 minutes)

**If auto-deploy enabled:**
- Push triggers automatic deployment
- Monitor Render/Vercel/etc dashboard

**If manual deploy:**
```bash
# Platform-specific command, or:
# Visit your deployment dashboard → Manual Deploy → Latest commit
```

**Wait for:** Build completes, deployment status = "Live"

---

### Step 3: Smoke Test Staging (30 minutes)

**Critical tests:**

```bash
# 1. Open staging URL in browser
# 2. Hard refresh: Ctrl+Shift+R (bypass cache)
# 3. Check console: No CSS errors
# 4. Tab through page: Focus rings visible (gold, 3px)
# 5. Test main flows:
#    - Landing page loads
#    - Decision feed renders
#    - Campaign cards show
#    - Metrics display correctly
# 6. Cross-browser check (Chrome, Firefox, Edge)
```

**Use full checklist:** `DEPLOYMENT-CHECKLIST.md` section "Smoke Test Checklist"

**Pass criteria:** No visual regressions, all accessibility features work

---

### Step 4: Production Deploy (if staging passed)

```bash
# Staging tests passed? Deploy to production:
# - Auto-deploy: Already live (if using continuous deployment)
# - Manual: Trigger production deployment via dashboard
```

**Monitor for 30 minutes:**
- No error spikes
- CSS loads correctly
- User experience unchanged

---

## 📋 Quick Smoke Test (Minimal)

**If time-constrained, test these 5 things:**

1. **CSS Loads**
   - Open DevTools → Network → Filter CSS
   - `index-*.css` loads successfully (~50 kB)
   - No 404 errors

2. **Focus Rings**
   - Press Tab key multiple times
   - Gold focus rings appear around interactive elements
   - Rings are 3px wide (not thin outlines)

3. **Typography**
   - Text appears consistent
   - No weird font rendering
   - Metric numbers use monospace font

4. **Console Clean**
   - No red errors in DevTools console
   - No "CSS variable undefined" warnings
   - No "@layer" errors

5. **One User Flow**
   - Upload CSV → View decisions → See recommendations
   - Flow completes without visual glitches

**If all 5 pass: Safe to deploy to production**

---

## 🔄 Rollback (If Needed)

**Only if critical issue found:**

```bash
cd g:\MARCOM\marketing-os-v3
git revert 9f80d62
git push origin master
# Wait for auto-redeploy
```

**Critical issues:** CSS fails to load, page unusable, accessibility broken  
**NOT critical:** Minor spacing, pre-existing lint warnings

---

## 📞 What to Communicate

**To frontend team:**
```
✅ Design System v2.0 deployed
- New typography classes available (see TYPOGRAPHY-QUICK-REF.md)
- CSS theming foundation ready
- No breaking changes
```

**To QA:**
```
🧪 Smoke test design system refactor
- Focus: Visual regression + accessibility
- See: DEPLOYMENT-CHECKLIST.md
- ETA: 30 min
```

---

## 📊 Expected Outcomes

**After deployment:**
- ✅ Visual appearance: Identical to before
- ✅ Functionality: Unchanged
- ✅ Accessibility: Improved (focus rings)
- ✅ Performance: ~Same (CSS +3%)
- ✅ Future: Dark mode ready, themable

**Metrics to watch:**
- CSS file size: ~50 kB (was ~48 kB)
- Page load time: No significant change
- Error rate: No increase
- User complaints: Zero expected

---

## 🎯 Success = No News

**Good signs:**
- No error alerts
- No user complaints
- CSS loads normally
- Everything works as before

**The refactor is invisible to users—that's the goal.**

---

## 📚 Full Documentation

- **Deployment Checklist:** `DEPLOYMENT-CHECKLIST.md` (comprehensive)
- **Architecture Guide:** `client/DESIGN-SYSTEM-REFACTOR.md` (what changed)
- **Developer Ref:** `client/TYPOGRAPHY-QUICK-REF.md` (new classes)

---

## ✅ Ready to Deploy

**Current status:**
- [x] Code committed locally (`9f80d62`)
- [x] Build passing
- [x] Pre-commit hooks passed
- [x] Documentation complete
- [ ] **→ Push to remote (run Step 1 above)**

**Next action:** Run `git push origin master` to begin deployment

---

**Prepared:** 2026-05-18  
**Commit:** `9f80d62`  
**Risk Level:** Minimal  
**Breaking Changes:** None  
**User Impact:** None (invisible refactor)
