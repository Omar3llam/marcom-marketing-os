# Firebase Migration — Files Checklist

## 📁 New Files Created

### Frontend
- ✅ `client/src/firebase.js` — Firebase client config & auth exports
- ✅ `client/src/context/AuthContext.jsx` — Auth context provider with hooks
- ✅ `client/src/pages/AuthPage-Firebase.jsx` — Modern login/signup UI (replace old AuthPage.jsx)

### Backend
- ✅ `src/utils/firebaseAdmin.js` — Firebase Admin SDK initialization
- ✅ `src/middleware/firebaseAuth.js` — Auth middleware (replaces clerkAuth.js)

### Documentation
- ✅ `FIREBASE-MIGRATION-COMMANDS.md` — Package install/uninstall commands
- ✅ `FIREBASE-MIGRATION-COMPLETE.md` — Full implementation guide
- ✅ `FIREBASE-FILES-CHECKLIST.md` — This file

---

## 📝 Modified Files

### Frontend
- ✅ `client/src/main.jsx` — Replaced ClerkProvider with AuthProvider
- ✅ `client/src/lib/api.js` — Updated token getter (Clerk → Firebase)
- ✅ `client/src/router/ProtectedRoute.jsx` — Uses Firebase auth state
- ✅ `client/src/pages/OnboardingPage.jsx` — Uses Firebase currentUser
- ✅ `client/src/components/layout/Sidebar.jsx` — Uses Firebase currentUser

### Backend
- ✅ `src/server.js` — Uses firebaseAuthMiddleware instead of clerkAuthMiddleware
- ✅ `src/routes/campaigns.js` — Updated /me/context endpoints for Firebase UID

---

## 🗑️ Files to Delete (Optional Cleanup)

After confirming Firebase works:

### Frontend
```bash
rm client/src/pages/AuthPage-Clerk-BACKUP.jsx  # If you backed it up
```

### Backend
```bash
rm src/middleware/clerkAuth.js  # Old Clerk middleware (no longer used)
```

---

## ⚙️ Configuration Files

### `.gitignore` (ADD THIS)
```gitignore
# Firebase Service Account - NEVER commit!
src/config/firebase-service-account.json
**/firebase-service-account*.json
*.firebaserc
```

### `package.json` Changes

#### Frontend (`client/package.json`)
**Remove:**
- `@clerk/clerk-react`

**Add:**
- `firebase`

#### Backend (`package.json`)
**Remove:**
- `@clerk/clerk-sdk-node`
- `@clerk/express`

**Add:**
- `firebase-admin`

---

## 🔐 Secrets & Environment Variables

### To Remove from Render

**Frontend:**
- `VITE_CLERK_PUBLISHABLE_KEY`

**Backend:**
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

### To Add to Render

**Frontend:**
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

**Backend:**
- `FIREBASE_SERVICE_ACCOUNT_PATH` (set to `./src/config/firebase-service-account.json`)

---

## 🚀 Deployment Steps

1. **Install packages**:
   ```bash
   cd client && npm install
   cd .. && npm install
   ```

2. **Place service account**:
   ```bash
   mkdir -p src/config
   # Move marcom-ai-722f0-firebase-adminsdk-fbsvc-04334f2a9e.json to src/config/firebase-service-account.json
   ```

3. **Replace AuthPage**:
   ```bash
   mv client/src/pages/AuthPage.jsx client/src/pages/AuthPage-Clerk-BACKUP.jsx
   mv client/src/pages/AuthPage-Firebase.jsx client/src/pages/AuthPage.jsx
   ```

4. **Update `.gitignore`**:
   ```bash
   echo "src/config/firebase-service-account.json" >> .gitignore
   ```

5. **Test locally**:
   ```bash
   npm run dev
   # Visit http://localhost:5000/login
   ```

6. **Update Render environment variables** (see above)

7. **Deploy to Render**:
   ```bash
   git add .
   git commit -m "feat: migrate from Clerk to Firebase Auth"
   git push origin master
   ```

---

## ✅ Post-Deployment Verification

1. Visit `/login` — Should see new Firebase UI
2. Sign up with email/password
3. Complete onboarding
4. Refresh page — Should stay logged in
5. Check backend logs for Firebase auth success
6. Test API calls with Firebase tokens

---

## 🔄 Rollback Plan (If Needed)

If Firebase migration causes issues:

1. **Restore Clerk**:
   ```bash
   git revert HEAD
   git push origin master
   ```

2. **Reinstall Clerk packages**:
   ```bash
   npm install @clerk/clerk-sdk-node @clerk/express
   cd client && npm install @clerk/clerk-react
   ```

3. **Restore environment variables** in Render

---

## 📊 Migration Status Tracking

- [ ] Packages installed
- [ ] Service account JSON placed in `src/config/`
- [ ] `.gitignore` updated
- [ ] Environment variables set in Render
- [ ] AuthPage replaced
- [ ] Local testing passed
- [ ] Deployed to staging/production
- [ ] Production login tested
- [ ] API calls verified with Firebase tokens
- [ ] Old Clerk users migrated successfully
- [ ] Clerk packages removed
- [ ] Clerk middleware deleted

---

**Last Updated**: 2026-05-04  
**Status**: Ready for deployment ✅
