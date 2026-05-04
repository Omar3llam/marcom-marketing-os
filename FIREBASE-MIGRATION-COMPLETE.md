# 🔥 Firebase Migration Complete - Implementation Guide

## ✅ What Was Changed

### Frontend (React/Vite)
1. **Removed Clerk**: All `@clerk/clerk-react` imports and usage
2. **Added Firebase**: New Firebase config, AuthContext, and auth utilities
3. **Updated Files**:
   - `client/src/firebase.js` — Firebase client configuration
   - `client/src/context/AuthContext.jsx` — Firebase auth context provider
   - `client/src/main.jsx` — Replaced ClerkProvider with AuthProvider
   - `client/src/lib/api.js` — Updated to use Firebase ID tokens
   - `client/src/router/ProtectedRoute.jsx` — Uses Firebase auth state
   - `client/src/pages/AuthPage-Firebase.jsx` — New modern login/signup UI
   - `client/src/pages/OnboardingPage.jsx` — Uses Firebase user data
   - `client/src/components/layout/Sidebar.jsx` — Uses Firebase user data

### Backend (Node.js/Express/Prisma)
1. **Removed Clerk**: All `@clerk/express` and `@clerk/clerk-sdk-node` usage
2. **Added Firebase Admin**: Token verification and user management
3. **Updated Files**:
   - `src/utils/firebaseAdmin.js` — Firebase Admin SDK initialization
   - `src/middleware/firebaseAuth.js` — New auth middleware (replaces clerkAuth)
   - `src/server.js` — Uses firebaseAuthMiddleware globally
   - `src/routes/campaigns.js` — Updated user lookups for Firebase UID

### Database (Prisma)
- **No schema changes required!** Firebase UIDs are stored in the existing `User.clerkId` column
- Backward compatible: existing Clerk users can migrate seamlessly

---

## 📦 Installation Steps

### 1. Install/Remove Packages

```bash
# Frontend
cd client
npm uninstall @clerk/clerk-react
npm install firebase
cd ..

# Backend
npm uninstall @clerk/clerk-sdk-node @clerk/express
npm install firebase-admin
```

### 2. Place Firebase Service Account File

Create directory and place the JSON file:

```bash
mkdir -p src/config
```

Then move `marcom-ai-722f0-firebase-adminsdk-fbsvc-04334f2a9e.json` to:
```
src/config/firebase-service-account.json
```

**⚠️ CRITICAL SECURITY**: Add to `.gitignore`:
```gitignore
# Firebase Service Account (NEVER commit!)
src/config/firebase-service-account.json
**/firebase-service-account*.json
*.firebaserc
```

### 3. Update Environment Variables

#### Frontend (Render Web Service or `.env`)

**Remove these:**
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

**Add these:**
```bash
VITE_FIREBASE_API_KEY=AIzaSyCLtn1Q7dzhN-SU_BwsfVulFBzZcQJNgqw
VITE_FIREBASE_AUTH_DOMAIN=marcom-ai-722f0.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=marcom-ai-722f0
VITE_FIREBASE_STORAGE_BUCKET=marcom-ai-722f0.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=117077763726
VITE_FIREBASE_APP_ID=1:117077763726:web:64f5bedc1e39204d4a4bdf
VITE_FIREBASE_MEASUREMENT_ID=G-T95N4FJH2B
```

#### Backend (Render Web Service or `.env`)

**Remove these:**
```bash
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

**Add this:**
```bash
FIREBASE_SERVICE_ACCOUNT_PATH=./src/config/firebase-service-account.json
```

### 4. Replace AuthPage

Replace the old AuthPage with the new Firebase version:

```bash
# Backup the old one (optional)
mv client/src/pages/AuthPage.jsx client/src/pages/AuthPage-Clerk-BACKUP.jsx

# Use the new Firebase version
mv client/src/pages/AuthPage-Firebase.jsx client/src/pages/AuthPage.jsx
```

---

## 🧪 Testing the Migration

### 1. Start the Development Server

```bash
npm run dev
```

### 2. Test Authentication Flow

1. **Navigate to `/login`** — You should see the new Firebase login UI
2. **Sign up with Email/Password** or use Google Sign-in
3. **Complete Onboarding** — Should save context and redirect to `/app`
4. **Refresh the page** — Should stay on `/app` (localStorage persistence works)
5. **Make an API call** — Check Network tab for `Authorization: Bearer <firebase-token>`

### 3. Test Protected Routes

- `/app/*` should redirect to `/login` if not authenticated
- `/onboarding` should redirect to `/app` if already onboarded
- All API calls should include Firebase ID tokens

### 4. Check Backend Logs

Look for these log messages:
```
[firebase-admin] Initialized successfully
[campaigns/me/context] created new user + workspace (Firebase)
```

---

## 🔄 Data Migration (Existing Clerk Users)

If you have existing Clerk users in production:

1. **No immediate action required** — The code supports both Clerk IDs and Firebase UIDs
2. **Users will be auto-migrated** when they log in with Firebase
3. **Lookup logic** finds users by:
   - Firebase UID (stored in `clerkId` column)
   - Email address (from Firebase token)

### Migration Script (Optional)

If you want to migrate users proactively, create `scripts/migrate-clerk-to-firebase.js`:

```javascript
import { prisma } from '../src/lib/prisma.js';

// 1. Export Clerk user emails
// 2. Create Firebase accounts programmatically via Admin SDK
// 3. Update User.clerkId with Firebase UIDs
```

---

## 🚀 Deployment Checklist

- [ ] Install packages (`npm install` on both frontend and backend)
- [ ] Place Firebase service account JSON in `src/config/`
- [ ] Update environment variables in Render
- [ ] Replace `AuthPage.jsx` with Firebase version
- [ ] Test login flow locally
- [ ] Test onboarding flow
- [ ] Test protected routes
- [ ] Deploy to Render
- [ ] Test production login
- [ ] Monitor logs for Firebase auth errors

---

## 🔧 Troubleshooting

### "Firebase configuration is missing"

**Solution**: Ensure `VITE_FIREBASE_PROJECT_ID` is set in Render environment variables and trigger a fresh deploy.

### "Firebase Admin initialization failed"

**Solution**: Check that `src/config/firebase-service-account.json` exists and is valid JSON.

### 401 Unauthorized on API calls

**Solution**: 
1. Check that Firebase token is being sent in `Authorization` header
2. Verify backend middleware is using `firebaseAuthMiddleware`
3. Check backend logs for token verification errors

### Users can't log in with existing accounts

**Solution**: The migration logic finds users by email. If a user signed up with Clerk using `user@example.com`, they can log in with Firebase using the same email.

---

## 📚 API Changes Summary

### Before (Clerk)
```javascript
// Frontend
const { getToken } = useAuth();  // Clerk
const token = await getToken();

// Backend
const userId = req.auth.userId;  // Clerk middleware
```

### After (Firebase)
```javascript
// Frontend
const { getIdToken } = useAuth();  // Firebase
const token = await getIdToken();

// Backend
const userId = req.user.uid;  // Firebase middleware
// OR (backward compatible)
const userId = req.userId;  // Also set by middleware
```

---

## 🎉 Benefits

✅ **No 401 Third-Party Cookie Errors** — Firebase uses first-party auth  
✅ **Better Browser Support** — Works in Firefox, Safari with strict settings  
✅ **Cost Savings** — No Clerk subscription fees  
✅ **Full Control** — Direct access to Firebase Admin SDK  
✅ **Backward Compatible** — Existing users migrate seamlessly  

---

## 🆘 Support

If you encounter issues:

1. Check Firebase Console for auth activity
2. Check backend logs for token verification errors
3. Verify environment variables are set correctly
4. Test locally before deploying to production

**Firebase Console**: https://console.firebase.google.com/project/marcom-ai-722f0

---

**Migration completed by**: Claude Sonnet 4.5  
**Date**: 2026-05-04  
**Status**: ✅ Ready for deployment
