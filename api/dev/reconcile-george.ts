import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { getSubscriptionDetails } from '../_lib/paypal.js';
import { calculateStackedExpiration, timestampToDate } from '../_lib/entitlements.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { syncDiscord } from '../_lib/discord.js';

const USER_ID = '9IPI8d9daOXJqUWdt2DzlUxv7ao2'; // george.mathew28921@gmail.com
const SUBSCRIPTION_ID = 'I-L9RJ7RPYW5L6';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const dryRun = req.query.dryRun === 'true';

  try {
    const subscription = await getSubscriptionDetails(SUBSCRIPTION_ID);
    const expectedPlanId = process.env.PAYPAL_AIO_PLAN_ID;

    const checks = {
      plan_id: subscription.plan_id,
      expectedPlanId,
      planMatches: subscription.plan_id === expectedPlanId,
      status: subscription.status,
      statusIsActive: subscription.status === 'ACTIVE',
      custom_id: subscription.custom_id,
      expectedUserId: USER_ID,
      ownerMatches: subscription.custom_id === USER_ID,
      last_payment: subscription.billing_info?.last_payment,
      next_billing_time: subscription.billing_info?.next_billing_time
    };

    if (!checks.planMatches || !checks.statusIsActive || !checks.ownerMatches) {
      return res.status(400).json({ error: 'Verification failed, refusing to grant', checks });
    }

    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(USER_ID);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    if (userData?.subscriptionId === SUBSCRIPTION_ID && userData?.subscriptionStatus === 'active') {
      return res.status(200).json({ success: true, alreadyConfirmed: true, checks });
    }

    const beforeAioExpires = timestampToDate(userData?.aioExpires)?.toISOString() || null;
    const aioExpirationDate = calculateStackedExpiration(userData?.aioExpires, 30);

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        checks,
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
      transactionId: null,
      orderId: null,
      subscriptionId: SUBSCRIPTION_ID,
      excludedFromRevenue: false,
      createdAt: FieldValue.serverTimestamp()
    });

    syncDiscord(USER_ID, 'aio').catch((err: any) => console.error('[ReconcileGeorge] Discord sync error:', err));
    const githubResult = await triggerLicenseSync(USER_ID, 'manual-reconcile');

    return res.status(200).json({
      success: true,
      checks,
      beforeAioExpires,
      afterAioExpires: aioExpirationDate.toISOString(),
      githubResult
    });
  } catch (err: any) {
    console.error('[ReconcileGeorge] Error:', err);
    return res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
}
