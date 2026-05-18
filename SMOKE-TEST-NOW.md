# 🧪 Smoke Test — Design System v2.0

**Run this test when Render deployment shows "Live"**

**URL:** https://marcom-marketing-os.onrender.com  
**Time Required:** 5 minutes  
**Focus:** CSS loading + accessibility

---

## ⚡ 5-Minute Quick Test

### 1. CSS Loads (30 seconds)

```
✅ Open: https://marcom-marketing-os.onrender.com
✅ Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
✅ Open DevTools: F12
✅ Go to Network tab
✅ Filter: CSS
✅ Check: index-*.css loads (should be ~50 kB)
✅ Status: 200 OK (not 404)
```

**Expected:** One CSS file loads successfully, no errors

---

### 2. Focus Rings (1 minute)

```
✅ Press Tab key multiple times
✅ Observe: Gold focus rings appear around buttons/links
✅ Check: Rings are visible (3px width, gold color)
✅ Check: Rings appear on ALL interactive elements
```

**Expected:** Gold focus rings visible on every Tab press

**What to look for:**
- 🟡 Gold/yellow ring color (not blue browser default)
- ⬜ 3px width (not thin 1px outline)
- ✅ Visible on light backgrounds
- ✅ Appears on buttons, inputs, links

---

### 3. Console Check (30 seconds)

```
✅ Open DevTools Console (F12 → Console tab)
✅ Check for errors (red text)
```

**Expected:** No CSS-related errors

**❌ BAD (needs rollback):**
```
Error: CSS variable --color-* undefined
Error: @layer components not recognized
Error: Failed to load stylesheet
```

**✅ GOOD:**
```
(No red errors, or only pre-existing warnings)
```

---

### 4. Typography Visual Check (1 minute)

```
✅ Look at page headings
✅ Check: Text appears consistent
✅ Check: Numbers use monospace font (not proportional)
✅ Check: Labels use uppercase styling
```

**Expected:** Text looks the same as before deployment

**What changed (should be invisible):**
- Font rendering: Same
- Spacing: Same
- Colors: Same
- Sizes: Same

---

### 5. One User Flow (2 minutes)

Pick ONE of these flows and complete it:

**Option A: Campaign Upload**
```
✅ Click "Upload CSV" or similar
✅ Select a test CSV file
✅ Submit
✅ Check: Upload completes
✅ Check: Results display correctly
```

**Option B: View Decisions**
```
✅ Navigate to Decision Feed
✅ Check: Campaign cards render
✅ Check: Metrics display correctly
✅ Click on a campaign
✅ Check: Detail view loads
```

**Option C: Authentication**
```
✅ Log out (if logged in)
✅ Go to login page
✅ Check: Page renders correctly
✅ Focus on input field (Tab or click)
✅ Check: Focus ring visible
```

**Expected:** Flow completes without visual glitches

---

## ✅ Pass Criteria

**Test PASSES if:**
- ✅ CSS file loads (Network tab shows 200 OK)
- ✅ Focus rings visible and gold (3px, not thin outline)
- ✅ No CSS errors in console
- ✅ Typography looks consistent
- ✅ One user flow works end-to-end

**Test FAILS if:**
- ❌ CSS file 404 or fails to load
- ❌ Focus rings invisible or wrong color
- ❌ Red errors in console about CSS/variables/@layer
- ❌ Text rendering broken
- ❌ User flow crashes or has visual glitches

---

## 🎯 Result

### If Test PASSES:

```
✅ Design System v2.0 deployment successful!

→ No action needed
→ Deployment complete
→ Monitor for 30 minutes for errors
```

### If Test FAILS:

```
❌ Rollback required

Run:
cd g:\MARCOM\marketing-os-v3
git revert 9f80d62
git push origin master

Then: Wait 5 minutes for Render to redeploy
```

---

## 📋 Report Template

```markdown
## Smoke Test Results

Date: [YYYY-MM-DD HH:MM]
Tester: [Your name]
URL: https://marcom-marketing-os.onrender.com
Commit: 9f80d62

### Results:
1. CSS Loads: ✅ / ❌
2. Focus Rings: ✅ / ❌
3. Console Clean: ✅ / ❌
4. Typography OK: ✅ / ❌
5. User Flow: ✅ / ❌

### Overall: ✅ PASS / ❌ FAIL

### Notes:
[Any observations]

### Decision: APPROVED FOR PRODUCTION / NEEDS ROLLBACK
```

---

## 🔍 Optional: Detailed Testing

**If you have more time (20 minutes), also test:**

### Cross-Browser (10 min)
- Chrome: Open in Chrome, repeat 5-minute test
- Firefox: Open in Firefox, repeat 5-minute test
- Edge: Open in Edge, repeat 5-minute test

### Reduced Motion (5 min)
- Windows: Settings → Accessibility → Animations → Off
- Mac: System Preferences → Accessibility → Display → Reduce motion
- Reload page, check animations are disabled/instant

### Font Scaling (5 min)
- Browser zoom to 200% (Ctrl/Cmd + +)
- Check text scales correctly
- Check layout remains usable

---

## 📞 Who to Notify

**If test PASSES:**
```
✅ Design System v2.0 deployed successfully to production
- Visual parity maintained
- Accessibility improved (WCAG AAA focus)
- CSS size +3% (acceptable)
- No issues detected
```

**If test FAILS:**
```
❌ Design System v2.0 deployment rolled back
- Issue: [describe what failed]
- Rollback: Reverted commit 9f80d62
- Status: Previous version restored
- Next: Debug locally before retry
```

---

**Prepared:** 2026-05-18  
**Deployment:** In progress  
**Expected completion:** ~7 minutes from push  
**Next:** Wait for Render "Live" status, then run this test
