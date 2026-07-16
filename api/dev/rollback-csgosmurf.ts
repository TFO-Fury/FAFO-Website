import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { triggerLicenseSync } from '../_lib/github.js';

// TEMPORARY one-off: rolls back the erroneous 30-day extension a customer
// got from the key-activation-while-on-trial bug, back to what their trial
// actually earned. Delete after use.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const firestore = await getDb();
    const usersSnap = await firestore.collection('users').where('email', '==', 'csgosmurf843@proton.me').limit(1).get();
    if (usersSnap.empty) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userDoc = usersSnap.docs[0];
    const userId = userDoc.id;
    const current = userDoc.data().aioExpires.toDate();
    const corrected = new Date(current.getTime() - 30 * 24 * 60 * 60 * 1000);

    await userDoc.ref.set({
      aioExpires: Timestamp.fromDate(corrected),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    const githubResult = await triggerLicenseSync(userId, 'manual-rollback');

    return res.status(200).json({
      success: true,
      userId,
      before: current.toISOString(),
      after: corrected.toISOString(),
      githubResult
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Rollback failed' });
  }
}
