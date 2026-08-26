import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { getSubscriptionDetails } from '../_lib/paypal.js';
import { timestampToDate } from '../_lib/entitlements.js';
import { triggerLicenseSync } from '../_lib/github.js';

const USER_ID = 'pw58UjH3AXNCJx03LW4CVfzm2lr2'; // jack55wolf@gmail.com
const SUBSCRIPTION_ID = 'I-SWW6GL6UAALT';
const SALE_ID = '5NK32343C1677801C';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const dryRun = req.query.dryRun === 'true';
  const expectedPlanId = process.env.PAYPAL_AIO_PLAN_ID;

  try {
    const subscription = await getSubscriptionDetails(SUBSCRIPTION_ID);
    const check = {
      plan_id: subscription.plan_id,
      planMatches: subscription.plan_id === expectedPlanId,
      status: subscription.status,
      custom_id: subscription.custom_id,
      ownerMatches: subscription.custom_id === USER_ID,
      last_payment: subscription.billing_info?.last_payment
    };

    if (!check.planMatches || !check.ownerMatches) {
      return res.status(400).json({ error: 'Verification failed, refusing to act', check });
    }

    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(USER_ID);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const currentAioExpires = timestampToDate(userData?.aioExpires)?.toISOString() || null;

    // Dedup: don't record twice if already linked.
    if (userData?.subscriptionId === SUBSCRIPTION_ID) {
      return res.status(200).json({ success: true, alreadyLinked: true, check, currentAioExpires });
    }

    if (dryRun) {
      return res.status(200).json({ dryRun: true, check, currentAioExpires, note: 'Will link subscriptionId + record order WITHOUT changing aioExpires (Darko already manually granted the equivalent period).' });
    }

    // Link the real subscription and record the real order, but leave
    // aioExpires untouched - Darko's manual admin-dev grant already covers
    // this exact payment's period (both land on ~9/25/2026), so stacking
    // another 30 days here would double-grant him.
    await userRef.set({
      subscriptionId: SUBSCRIPTION_ID,
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
      transactionId: SALE_ID,
      orderId: null,
      subscriptionId: SUBSCRIPTION_ID,
      excludedFromRevenue: false,
      createdAt: FieldValue.serverTimestamp()
    });

    const githubResult = await triggerLicenseSync(USER_ID, 'manual-reconcile');

    return res.status(200).json({
      success: true,
      check,
      currentAioExpires,
      githubResult
    });
  } catch (err: any) {
    console.error('[ReconcileJack] Error:', err);
    return res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
}
