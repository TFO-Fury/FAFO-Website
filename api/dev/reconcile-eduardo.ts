import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { getSubscriptionDetails, cancelSubscription } from '../_lib/paypal.js';
import { calculateStackedExpiration, timestampToDate } from '../_lib/entitlements.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { syncDiscord } from '../_lib/discord.js';

const USER_ID = 'EfsaBkJli9Trg4RglsjT0H8CgPI2'; // privacyed@proton.me / Discord "maev"
const SUBSCRIPTION_IDS = ['I-NNW4E594FDYW', 'I-5GTX5P5AX620'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const dryRun = req.query.dryRun === 'true';
  const expectedPlanId = process.env.PAYPAL_AIO_PLAN_ID;

  try {
    const subs = await Promise.all(SUBSCRIPTION_IDS.map(id => getSubscriptionDetails(id)));

    const checks = subs.map((s, i) => ({
      subscriptionId: SUBSCRIPTION_IDS[i],
      plan_id: s.plan_id,
      planMatches: s.plan_id === expectedPlanId,
      status: s.status,
      statusIsActive: s.status === 'ACTIVE',
      custom_id: s.custom_id,
      ownerMatches: s.custom_id === USER_ID,
      last_payment: s.billing_info?.last_payment,
      create_time: s.create_time
    }));

    const allValid = checks.every(c => c.planMatches && c.ownerMatches);
    if (!allValid) {
      return res.status(400).json({ error: 'Verification failed, refusing to act', checks });
    }

    // Keep the earliest-created subscription as canonical, cancel the other duplicate.
    const sorted = [...checks].sort((a, b) => new Date(a.create_time).getTime() - new Date(b.create_time).getTime());
    const keepId = sorted[0].subscriptionId;
    const cancelId = sorted[1].subscriptionId;

    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(USER_ID);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    const beforeAioExpires = timestampToDate(userData?.aioExpires)?.toISOString() || null;
    const aioExpirationDate = calculateStackedExpiration(userData?.aioExpires, 30);

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        checks,
        keepId,
        cancelId,
        beforeAioExpires,
        wouldSetAioExpires: aioExpirationDate.toISOString()
      });
    }

    const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

    await userRef.set({
      plan: 'aio',
      isAio: true,
      accountStatus: 'active',
      aioExpires: aioExpirationTimestamp,
      classEntitlements: FieldValue.delete(),
      selectedClass: FieldValue.delete(),
      subscriptionId: keepId,
      subscriptionStatus: 'active',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await firestore.collection('orders').add({
      userId: USER_ID,
      email: userData?.email || null,
      plan: 'aio',
      className: null,
      amount: 35,
      currency: 'USD',
      source: 'paypal-subscription-manual-reconcile',
      paymentProvider: 'paypal',
      paymentStatus: 'completed',
      transactionId: null,
      orderId: null,
      subscriptionId: keepId,
      excludedFromRevenue: false,
      createdAt: FieldValue.serverTimestamp()
    });

    let cancelResult: any = { attempted: true, success: false };
    try {
      await cancelSubscription(cancelId, 'Duplicate subscription created due to a checkout bug - customer was double-charged, canceling the duplicate');
      cancelResult = { attempted: true, success: true };
    } catch (err: any) {
      cancelResult = { attempted: true, success: false, error: err.message };
    }

    syncDiscord(USER_ID, 'aio').catch((err: any) => console.error('[ReconcileEduardo] Discord sync error:', err));
    const githubResult = await triggerLicenseSync(USER_ID, 'manual-reconcile');

    return res.status(200).json({
      success: true,
      checks,
      keepId,
      cancelId,
      cancelResult,
      beforeAioExpires,
      afterAioExpires: aioExpirationDate.toISOString(),
      githubResult
    });
  } catch (err: any) {
    console.error('[ReconcileEduardo] Error:', err);
    return res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
}
