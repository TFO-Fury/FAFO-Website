import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { verifyIdToken } from '../_lib/auth.js';
import { cancelSubscription } from '../_lib/paypal.js';

// Self-service. A user can only cancel their own subscription. Entitlements
// are left untouched - they keep AIO access until aioExpires, same as the
// webhook's cancellation handling.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let decoded;
  try {
    decoded = await verifyIdToken(req);
  } catch (err: any) {
    return res.status(401).json({ error: err.message || 'Unauthorized' });
  }

  const body = await readJsonBody(req);
  const { userId } = body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  if (decoded.uid !== userId) {
    return res.status(403).json({ error: 'Cannot cancel a subscription for another user' });
  }

  try {
    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    const subscriptionId = userData?.subscriptionId;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'No active subscription found for this account' });
    }
    if (userData?.subscriptionStatus === 'cancelled') {
      return res.status(200).json({ success: true, alreadyCancelled: true });
    }

    await cancelSubscription(subscriptionId, 'Cancelled by user from dashboard');

    await userRef.set({
      subscriptionStatus: 'cancelled',
      subscriptionCancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[CancelSubscription] User ${userId} cancelled subscription ${subscriptionId}`);

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('[CancelSubscription] Error:', err);
    return res.status(500).json({ error: err.message || 'Cancellation failed' });
  }
}
