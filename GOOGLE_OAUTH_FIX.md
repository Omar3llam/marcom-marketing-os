# Google OAuth "Disallowed Useragent" Fix

**Issue:** Google OAuth authentication failing with `Error 403: disallowed_useragent` when users try to sign in from embedded webviews (Facebook Messenger, Instagram, etc.) or mobile browsers.

**Root Cause:** The app was using `signInWithPopup()` which doesn't work in:
- Embedded webviews (Facebook, Instagram, LINE, etc.)
- Some mobile browsers
- Any browser that Google flags as "insecure"

---

## Changes Made

### 1. [client/src/firebase.js](client/src/firebase.js)

**Added:**
- `signInWithRedirect` import
- `getRedirectResult` import
- `isEmbeddedWebviewOrMobile()` detection function
- Exported new auth methods

**Purpose:** Detect when user is in an embedded browser and switch authentication flow from popup to redirect.

### 2. [client/src/context/AuthContext.jsx](client/src/context/AuthContext.jsx)

**Updated `signInWithGoogle()`:**
- Auto-detects embedded webviews/mobile browsers
- Uses **redirect flow** for mobile/embedded (fixes Error 403)
- Uses **popup flow** for desktop browsers (existing behavior)

**Added redirect result handler:**
- New `useEffect` hook to process redirect results
- Handles users returning from Google OAuth redirect
- Logs errors without blocking re-attempts

### 3. [client/src/pages/AuthPage.jsx](client/src/pages/AuthPage.jsx)

**Enhanced error handling:**
- Detects `disallowed_useragent` errors
- Shows user-friendly embedded browser warning
- Provides "Copy link" button to open in proper browser

**New UI:**
- Warning banner for embedded browser users
- Better error messages for OAuth failures
- Network error handling

---

## Firebase Console Setup (REQUIRED)

You need to verify authorized domains in Firebase Console:

### Step 1: Add Authorized Domains

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **marcom-ai-722f0**
3. Navigate to **Authentication** → **Settings** → **Authorized domains**
4. Ensure these domains are listed:
   - `localhost` (for development)
   - `marcom-ai-722f0.firebaseapp.com` (Firebase hosting)
   - Your production domain (e.g., `app.yourcompany.com`)

### Step 2: Google Cloud Console OAuth Settings

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select project: **marcom-ai-722f0**
3. Navigate to **APIs & Services** → **Credentials**
4. Find your **OAuth 2.0 Client ID** (Web application)
5. Click Edit and verify:

**Authorized JavaScript origins:**
```
http://localhost:5173
http://localhost:3000
https://marcom-ai-722f0.firebaseapp.com
https://your-production-domain.com
```

**Authorized redirect URIs:**
```
http://localhost:5173/__/auth/handler
http://localhost:3000/__/auth/handler
https://marcom-ai-722f0.firebaseapp.com/__/auth/handler
https://your-production-domain.com/__/auth/handler
```

⚠️ **CRITICAL:** The `/__/auth/handler` path is required for Firebase redirect flow.

### Step 3: Verify OAuth Consent Screen

1. In Google Cloud Console → **OAuth consent screen**
2. Ensure:
   - App name is set
   - Support email is set
   - Authorized domains includes `firebaseapp.com` and your domain
   - Publishing status: **In production** (or **Testing** for development)

---

## Testing

### Test 1: Desktop Browser (Chrome/Firefox/Safari)
1. Open `http://localhost:5173` (or your dev URL)
2. Click "Continue with Google"
3. Should see **popup window** (existing behavior)
4. Complete sign-in → redirected to `/onboarding`

### Test 2: Mobile Browser (Safari/Chrome on iOS/Android)
1. Open the app on mobile
2. Click "Continue with Google"
3. Should be **redirected** to Google (full-page, not popup)
4. Complete sign-in → redirected back to app → `/onboarding`

### Test 3: Embedded Browser (Facebook Messenger)
1. Send the app URL in Facebook Messenger
2. Open link in Messenger's in-app browser
3. Click "Continue with Google"
4. Should see **yellow warning banner**: "Open in your browser"
5. Click "Copy link" → paste in Safari/Chrome
6. Sign-in should work

### Test 4: Error Handling
1. Disconnect internet
2. Try Google sign-in
3. Should see: "Network error. Please check your connection."

---

## User Experience Changes

**Desktop users:** No change — still uses popup flow

**Mobile users:** 
- Now uses redirect flow (full-page, not popup)
- More reliable, works on all mobile browsers
- Matches Google's recommended practice

**Embedded browser users:**
- Auth attempt triggers helpful warning
- Guided to open in proper browser
- Copy link button for convenience

---

## Debug Logs

The following console logs help track the auth flow:

```
[AuthContext] signInWithGoogle called { useRedirect: true/false, userAgent: '...' }
[AuthContext] Redirect result received: { user: 'email@example.com', providerId: 'google.com' }
[AuthPage] Google sign-in error: { code: 'auth/...', message: '...' }
```

---

## Rollback Plan

If issues arise, revert these commits:

```bash
git log --oneline --all -10  # find the commit hash
git revert <commit-hash>
```

The app will fall back to popup-only flow (pre-fix behavior).

---

## Next Steps

1. ✅ Code changes applied
2. ⏳ **YOU MUST:** Verify Firebase Console authorized domains
3. ⏳ **YOU MUST:** Verify Google Cloud OAuth redirect URIs
4. ⏳ Test on desktop browser
5. ⏳ Test on mobile browser
6. ⏳ Test in Facebook Messenger (or similar embedded browser)
7. ⏳ Deploy to production
8. ⏳ Monitor for auth errors in production logs

---

## Production Deployment Checklist

- [ ] All tests pass locally
- [ ] Firebase authorized domains configured
- [ ] Google OAuth redirect URIs configured
- [ ] OAuth consent screen verified
- [ ] Desktop browser tested
- [ ] Mobile browser tested
- [ ] Embedded browser tested (shows warning)
- [ ] Production domain added to authorized domains
- [ ] Production redirect URIs added
- [ ] CORS settings allow production domain
- [ ] Monitor auth success rate post-deploy

---

## Common Errors & Solutions

### Error: "redirect-cancelled-by-user"
**Cause:** User closed the redirect before completing sign-in
**Solution:** User should try again — not a code issue

### Error: "unauthorized-domain"
**Cause:** Current domain not in Firebase authorized domains
**Solution:** Add domain in Firebase Console → Authentication → Authorized domains

### Error: "operation-not-allowed"
**Cause:** Google sign-in not enabled in Firebase
**Solution:** Firebase Console → Authentication → Sign-in method → Enable Google

### Error: Still getting "disallowed_useragent"
**Cause:** Browser is still using popup flow instead of redirect
**Solution:** Check `isEmbeddedWebviewOrMobile()` detection logic — may need to add more user agents

---

## Architecture Notes

**Why redirect instead of popup?**
- Google blocks popups in embedded browsers for security
- Redirect flow is Google's recommended approach for mobile
- Works universally across all browsers and webviews

**Why not always use redirect?**
- Desktop users prefer popup (doesn't leave the page)
- Better UX for desktop workflows
- Auto-detection gives best of both worlds

**Fallback strategy:**
- Desktop: popup (existing behavior)
- Mobile/embedded: redirect (new behavior)
- Errors: show helpful message + copy link button

---

**Created:** 2026-05-18  
**Last updated:** 2026-05-18  
**Affects:** All Google OAuth sign-in flows (login + signup)
