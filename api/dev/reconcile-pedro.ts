import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { getSubscriptionDetails, cancelSubscription } from '../_lib/paypal.js';
import { calculateStackedExpiration, timestampToDate } from '../_lib/entitlements.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { syncDiscord } from '../_lib/discord.js';

const USER_ID = 'qTFgYdwA8JPHCERkeRjPWWEWSUo1'; // pedrosampaiomed@gmail.com
const SUBSCRIPTION_IDS = ['I-7621P24NE4X1', 'I-XENL422S5E7U'];

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
    const keepStatus = sorted[0].status;

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
        keepStatus,
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
      subscriptionStatus: keepStatus === 'ACTIVE' ? 'active' : keepStatus.toLowerCase(),
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

    let cancelResult: any = { attempted: false };
    if (keepStatus === 'ACTIVE' || sorted[1].status === 'ACTIVE') {
      try {
        await cancelSubscription(cancelId, 'Duplicate subscription created due to a checkout bug - customer was double-charged on signup and again on renewal, canceling the duplicate');
        cancelResult = { attempted: true, success: true };
      } catch (err: any) {
        cancelResult = { attempted: true, success: false, error: err.message };
      }
    } else {
      cancelResult = { attempted: false, reason: `duplicate status is already ${sorted[1].status}` };
    }

    syncDiscord(USER_ID, 'aio').catch((err: any) => console.error('[ReconcilePedro] Discord sync error:', err));
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
    console.error('[ReconcilePedro] Error:', err);
    return res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
}
