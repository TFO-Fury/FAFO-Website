import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { verifyIdToken } from '../_lib/auth.js';
import { getSubscriptionDetails } from '../_lib/paypal.js';
import { calculateStackedExpiration } from '../_lib/entitlements.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { syncDiscord } from '../_lib/discord.js';

// The PayPal JS SDK creates the subscription client-side
// (actions.subscription.create), so unlike one-time orders there's no
// server-computed amount to protect - the price is fixed in the
// pre-created Plan. But we still never trust the client's claim that it
// succeeded: re-fetch the subscription from PayPal and verify its plan,
// owner, and status before granting anything.
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
  const { userId, subscriptionId } = body || {};

  if (!userId || !subscriptionId) {
    return res.status(400).json({ error: 'userId and subscriptionId required' });
  }
  if (decoded.uid !== userId) {
    return res.status(403).json({ error: 'Cannot confirm a subscription for another user' });
  }

  try {
    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    // Already confirmed (double-click / retry) - no-op success.
    if (userData?.subscriptionId === subscriptionId && userData?.subscriptionStatus === 'active') {
      return res.status(200).json({ success: true, alreadyConfirmed: true });
    }

    const subscription = await getSubscriptionDetails(subscriptionId);

    const expectedPlanId = process.env.PAYPAL_AIO_PLAN_ID;
    if (!expectedPlanId || subscription.plan_id !== expectedPlanId) {
      return res.status(400).json({ error: 'Subscription is not for the expected plan' });
    }
    if (subscription.custom_id !== userId) {
      return res.status(403).json({ error: 'Subscription does not belong to this user' });
    }
    if (subscription.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Subscription is not active (status: ${subscription.status})` });
    }

    const days = 30;
    const aioExpirationDate = calculateStackedExpiration(userData?.aioExpires, days);
    const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

    await userRef.set({
      plan: 'aio',
      isAio: true,
      accountStatus: 'active',
      aioExpires: aioExpirationTimestamp,
      classEntitlements: FieldValue.delete(),
      selectedClass: FieldValue.delete(),
      subscriptionId,
      subscriptionStatus: 'active',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await firestore.collection('orders').add({
      userId,
      email: userData?.email || decoded.email || null,
      plan: 'aio',
      className: null,
      amount: 35,
      currency: 'USD',
      source: 'paypal-subscription',
      paymentProvider: 'paypal',
      paymentStatus: 'completed',
      transactionId: null,
      orderId: null,
      subscriptionId,
      excludedFromRevenue: false,
      createdAt: FieldValue.serverTimestamp()
    });

    syncDiscord(userId, 'aio').catch((err: any) => console.error('[ConfirmSubscription] Discord sync error:', err));
    const githubResult = await triggerLicenseSync(userId, 'confirm-subscription');

    console.log(`[ConfirmSubscription] Activated subscription ${subscriptionId} for userId=${userId}, expires=${aioExpirationDate.toISOString()}`);

    return res.status(200).json({
      success: true,
      plan: 'aio',
      expiresAt: aioExpirationDate.toISOString(),
      githubSync: githubResult
    });
  } catch (err: any) {
    console.error('[ConfirmSubscription] Error:', err);
    return res.status(500).json({ error: err.message || 'Subscription confirmation failed' });
  }
}
