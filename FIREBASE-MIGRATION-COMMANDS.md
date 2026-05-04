# Firebase Migration Commands

## Frontend

```bash
# Remove Clerk
cd client
npm uninstall @clerk/clerk-react

# Install Firebase
npm install firebase

# Return to root
cd ..
```

## Backend

```bash
# Remove Clerk
npm uninstall @clerk/clerk-sdk-node @clerk/express

# Install Firebase Admin
npm install firebase-admin
```

## Environment Variables

### Frontend (.env or Render environment)
```
# Remove these:
# VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# Add these:
VITE_FIREBASE_API_KEY=AIzaSyCLtn1Q7dzhN-SU_BwsfVulFBzZcQJNgqw
VITE_FIREBASE_AUTH_DOMAIN=marcom-ai-722f0.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=marcom-ai-722f0
VITE_FIREBASE_STORAGE_BUCKET=marcom-ai-722f0.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=117077763726
VITE_FIREBASE_APP_ID=1:117077763726:web:64f5bedc1e39204d4a4bdf
VITE_FIREBASE_MEASUREMENT_ID=G-T95N4FJH2B
```

### Backend (.env)
```
# Add this:
FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
```

## Service Account File Placement

Place `marcom-ai-722f0-firebase-adminsdk-fbsvc-04334f2a9e.json` at:
```
src/config/firebase-service-account.json
```

Or set the full path in the environment variable.

⚠️ **IMPORTANT**: Add this to `.gitignore`:
```
src/config/firebase-service-account.json
**/firebase-service-account*.json
```
