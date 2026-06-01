// MARCOM Firebase Auth Reset
import 'dotenv/config';
import admin from 'firebase-admin';

// Initialize Firebase
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

console.log('\n🔥 Firebase Project:', admin.app().options.projectId);
console.log('🗑️  Deleting all Firebase Auth users...\n');

async function deleteAllUsers() {
  let totalDeleted = 0;
  let pageToken;

  try {
    do {
      const listResult = await admin.auth().listUsers(1000, pageToken);
      const uids = listResult.users.map(u => u.uid);

      if (uids.length > 0) {
        console.log(`  Deleting batch of ${uids.length} users...`);
        const deleteResult = await admin.auth().deleteUsers(uids);
        totalDeleted += deleteResult.successCount;

        if (deleteResult.failureCount > 0) {
          console.error(`  ⚠️  Failed: ${deleteResult.failureCount} users`);
        }
      }

      pageToken = listResult.pageToken;
    } while (pageToken);

    console.log(`\n✅ Deleted ${totalDeleted} Firebase users\n`);

    // Verify
    const remaining = await admin.auth().listUsers(1);
    console.log(`📊 Users remaining: ${remaining.users.length}\n`);

  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
}

deleteAllUsers();
