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

    const check = {
      plan_id: subscription.plan_id,
      planMatches: subscription.plan_id === expectedPlanId,
      status: subscription.status,
      custom_id: subscription.custom_id,
      ownerMatches: subscription.custom_id === USER_ID,
      last_payment: subscription.billing_info?.last_payment,
      next_billing_time: subscription.billing_info?.next_billing_time
    };

    if (!check.planMatches || !check.ownerMatches) {
      return res.status(400).json({ error: 'Verification failed, refusing to act', check });
    }

    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(USER_ID);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    // Dedup against this specific renewal sale transaction.
    const lastPaymentTime = subscription.billing_info?.last_payment?.time;
    const dupCheck = await firestore.collection('orders')
      .where('subscriptionId', '==', SUBSCRIPTION_ID)
      .get();
    const alreadyRecorded = dupCheck.docs.some(d => {
      const createdAt = d.data().createdAt?.toDate?.();
      // Same renewal window if an order for this sub was created within an hour of the payment time.
      return createdAt && lastPaymentTime && Math.abs(createdAt.getTime() - new Date(lastPaymentTime).getTime()) < 3600000;
    });
    if (alreadyRecorded) {
      return res.status(200).json({ success: true, alreadyRecorded: true, check });
    }

    const beforeAioExpires = timestampToDate(userData?.aioExpires)?.toISOString() || null;
    const aioExpirationDate = calculateStackedExpiration(userData?.aioExpires, 30);

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        check,
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
      source: 'paypal-subscription-renewal-manual-reconcile',
      paymentProvider: 'paypal',
      paymentStatus: 'completed',
      transactionId: null,
      orderId: null,
      subscriptionId: SUBSCRIPTION_ID,
      excludedFromRevenue: false,
      createdAt: FieldValue.serverTimestamp()
    });

    syncDiscord(USER_ID, 'aio').catch((err: any) => console.error('[ReconcileGeorge2] Discord sync error:', err));
    const githubResult = await triggerLicenseSync(USER_ID, 'manual-reconcile');

    return res.status(200).json({
      success: true,
      check,
      beforeAioExpires,
      afterAioExpires: aioExpirationDate.toISOString(),
      githubResult
    });
  } catch (err: any) {
    console.error('[ReconcileGeorge2] Error:', err);
    return res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
}
