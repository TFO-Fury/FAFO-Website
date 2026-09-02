import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { verifyWebhookSignature, capturePayPalOrder, getSubscriptionDetails } from '../_lib/paypal.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { syncDiscord } from '../_lib/discord.js';
import { calculateStackedExpiration, timestampToDate } from '../_lib/entitlements.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  const headers = req.headers;

  // Webhook verification
  const transmissionId = headers['paypal-transmission-id'] as string;
  const certUrl = headers['paypal-cert-url'] as string;
  const authAlgo = headers['paypal-auth-algo'] as string;
  const transmissionTime = headers['paypal-transmission-time'] as string;
  const transmissionSig = headers['paypal-transmission-sig'] as string;

  const verified = await verifyWebhookSignature(
    transmissionId, certUrl, authAlgo, transmissionTime, transmissionSig, body
  );

  if (!verified) {
    console.warn('[PayPalWebhook] Signature verification failed');
    return res.status(400).json({ error: 'Webhook verification failed' });
  }

  const eventType = body?.event_type;
  const resource = body?.resource;
  const orderId = resource?.id;

  console.log(`[PayPalWebhook] Received ${eventType} for order ${orderId}`);

  // The response is sent only AFTER processing fully completes (see catch
  // block below) - NOT acknowledged upfront. Sending 200 before finishing the
  // awaited Firestore work below let Vercel freeze/kill this function's
  // execution context right after the response flushed, before those awaits
  // ever ran - the logs for every real incident this caused (Pedro, George,
  // Sebastian) show the handler getting exactly as far as "connecting to
  // Firestore" and then just stopping, no further log line, no error. It
  // also meant PayPal always saw success even when processing crashed, so
  // its own automatic webhook retry never had a chance to recover a
  // transient failure - a real payment could vanish with nothing to catch it.
  try {
    const firestore = await getDb();

    // --- Subscription lifecycle events are keyed by subscriptionId (or the
    // sale's billing_agreement_id), never a paypal_orders doc, so they're
    // handled independently of the one-time-order flow below. ---

    if (eventType === 'PAYMENT.SALE.COMPLETED' && resource?.billing_agreement_id) {
      const subscriptionId = resource.billing_agreement_id;
      const saleId = resource.id;

      let userDoc = (await firestore.collection('users')
        .where('subscriptionId', '==', subscriptionId)
        .limit(1)
        .get()).docs[0];

      // Self-healing fallback: if confirm-subscription.ts (the client-driven
      // path) never ran - network hiccup, the tab closed early, a bug, etc -
      // no user has this subscriptionId recorded, even though PayPal already
      // charged them. This happened in production: a customer was charged
      // twice with zero entitlement granted, because this handler used to
      // just log a warning and give up when it couldn't find a match. Ask
      // PayPal directly for the subscription's custom_id (the userId set at
      // creation) and recover instead of silently dropping a real payment.
      if (!userDoc) {
        try {
          const subscription = await getSubscriptionDetails(subscriptionId);
          const fallbackUserId = subscription.custom_id;
          if (fallbackUserId) {
            const snap = await firestore.collection('users').doc(fallbackUserId).get();
            if (snap.exists) {
              userDoc = snap as any;
              console.warn(`[PayPalWebhook] Recovered orphaned subscription ${subscriptionId} -> user ${fallbackUserId} via custom_id fallback`);
            }
          }
        } catch (err: any) {
          console.error(`[PayPalWebhook] custom_id fallback lookup failed for subscription ${subscriptionId}:`, err);
        }
      }

      if (!userDoc) {
        console.warn(`[PayPalWebhook] No user found for subscription ${subscriptionId} (sale ${saleId}), even after custom_id fallback`);
        return;
      }

      const userRef = userDoc.ref;
      const userData = userDoc.data();

      // Dedup: skip if this sale was already recorded (e.g. webhook retry).
      const dupQuery = await firestore.collection('orders')
        .where('transactionId', '==', saleId)
        .limit(1)
        .get();
      if (!dupQuery.empty) {
        console.log(`[PayPalWebhook] Deduplication: sale ${saleId} already processed, skipping`);
        return;
      }

      // PayPal sends PAYMENT.SALE.COMPLETED for a subscription's very FIRST
      // payment too, not just true renewals - confirm-subscription.ts (the
      // client-driven path) already grants that first payment's 30 days on
      // its own, with its own order record (transactionId: null, so the
      // saleId check above never catches it). Before this webhook could
      // actually complete (see the response-timing fix above), that race
      // never mattered - the webhook always died first. Now that it
      // completes, both paths were granting the same first payment,
      // double-stacking new subscribers to ~60 days with two order records
      // each. A true renewal is ~30 days after the last order for this
      // subscription, so anything within the last hour is unambiguously the
      // same initial-payment race, never a real second cycle.
      const recentForSubQuery = await firestore.collection('orders')
        .where('subscriptionId', '==', subscriptionId)
        .get();
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const hasRecentOrder = recentForSubQuery.docs.some(d => {
        const createdAt = d.data().createdAt?.toDate?.();
        return createdAt && createdAt.getTime() > oneHourAgo;
      });
      if (hasRecentOrder) {
        console.log(`[PayPalWebhook] Subscription ${subscriptionId} already has a recent order (initial-payment race with confirm-subscription) - skipping renewal grant for sale ${saleId}`);
        return;
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
        userId: userRef.id,
        email: userData?.email || null,
        paypalEmail: resource?.payer?.email_address || null,
        plan: 'aio',
        className: null,
        amount: 35,
        currency: 'USD',
        source: 'paypal-subscription-renewal',
        paymentProvider: 'paypal',
        paymentStatus: 'completed',
        transactionId: saleId,
        orderId: null,
        subscriptionId,
        excludedFromRevenue: false,
        createdAt: FieldValue.serverTimestamp()
      });

      syncDiscord(userRef.id, 'aio').catch((err: any) => console.error('[Discord Sync Error]', err));
      triggerLicenseSync(userRef.id, 'paypal-subscription-renewal').catch((err: any) => console.error('[LicenseSync] Renewal sync failed:', err));

      console.log(`[PayPalWebhook] Subscription ${subscriptionId} renewed for ${userRef.id}, expires=${aioExpirationDate.toISOString()}`);
      return;
    }

    if (
      eventType === 'BILLING.SUBSCRIPTION.CANCELLED' ||
      eventType === 'BILLING.SUBSCRIPTION.SUSPENDED' ||
      eventType === 'BILLING.SUBSCRIPTION.EXPIRED'
    ) {
      const subscriptionId = resource?.id;
      if (!subscriptionId) {
        console.warn(`[PayPalWebhook] Missing subscription ID in ${eventType} event`);
        return;
      }

      const usersQuery = await firestore.collection('users')
        .where('subscriptionId', '==', subscriptionId)
        .limit(1)
        .get();

      if (usersQuery.empty) {
        console.warn(`[PayPalWebhook] No user found for subscription ${subscriptionId} (${eventType})`);
        return;
      }

      const statusMap: Record<string, string> = {
        'BILLING.SUBSCRIPTION.CANCELLED': 'cancelled',
        'BILLING.SUBSCRIPTION.SUSPENDED': 'suspended',
        'BILLING.SUBSCRIPTION.EXPIRED': 'expired'
      };

      const userRef = usersQuery.docs[0].ref;
      await userRef.set({
        subscriptionStatus: statusMap[eventType],
        subscriptionCancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`[PayPalWebhook] Subscription ${subscriptionId} marked as ${statusMap[eventType]} (entitlements preserved until expiration)`);
      return;
    }

    // --- One-time order events (existing flow) ---
    const paypalOrderRef = firestore.collection('paypal_orders').doc(orderId);
    const paypalOrderSnap = await paypalOrderRef.get();

    if (!paypalOrderSnap.exists) {
      console.warn(`[PayPalWebhook] Unknown order ${orderId}`);
      return;
    }

    const paypalData = paypalOrderSnap.data()!;
    const userId = paypalData.userId;
    const plan = paypalData.plan;
    const className = paypalData.className;

    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      // Capture the order automatically
      try {
        await capturePayPalOrder(orderId);
        console.log(`[PayPalWebhook] Auto-captured order ${orderId}`);
      } catch (capErr: any) {
        console.error(`[PayPalWebhook] Auto-capture failed for ${orderId}:`, capErr);
        // Likely transient (a PayPal API call failing) - a 500 lets PayPal's own webhook retry recover it.
        res.status(500).json({ error: 'Auto-capture failed' });
        return;
      }
    }

    if (eventType === 'CHECKOUT.ORDER.COMPLETED' || eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      // Already captured via frontend or auto-capture above
      // Ensure entitlements + order entry exist
      const userRef = firestore.collection('users').doc(userId);
      const userDoc = await userRef.get();
      const existingData = userDoc.exists ? userDoc.data() : null;

      const captureId = resource?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      const dedupId = captureId || orderId;

      // Check if already processed (by transactionId or orderId)
      let ordersQuery = await firestore.collection('orders')
        .where('transactionId', '==', dedupId)
        .limit(1)
        .get();

      if (ordersQuery.empty && orderId) {
        ordersQuery = await firestore.collection('orders')
          .where('orderId', '==', orderId)
          .limit(1)
          .get();
      }

      if (!ordersQuery.empty) {
        console.log(`[PayPalWebhook] Deduplication: Order ${orderId} already processed, skipping`);
        return;
      }

      const days = plan === 'trial' ? 3 : 30;
      const existingClasses = existingData?.classEntitlements || {};

      // Stacked expiration: MAX(current, now) + duration
      const prevAioExp = timestampToDate(existingData?.aioExpires);
      const aioExpirationDate = calculateStackedExpiration(existingData?.aioExpires, days);
      const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

      const prevClassExp = timestampToDate(existingClasses[className]?.expires);
      const classExpirationDate = calculateStackedExpiration(existingClasses[className]?.expires, days);
      const classExpirationTimestamp = Timestamp.fromDate(classExpirationDate);

      console.log(`[PayPalWebhook] duration=${days}d, prevAio=${prevAioExp?.toISOString() || 'none'}, prevClass=${prevClassExp?.toISOString() || 'none'}, now=${new Date().toISOString()}, newAio=${aioExpirationDate.toISOString()}, newClass=${classExpirationDate.toISOString()}`);

      const updatePayload: Record<string, any> = {
        plan,
        accountStatus: 'active',
        updatedAt: FieldValue.serverTimestamp()
      };

      if (plan === 'aio' || plan === 'trial') {
        updatePayload.isAio = true;
        updatePayload.aioExpires = aioExpirationTimestamp;
        updatePayload.classEntitlements = FieldValue.delete();
        updatePayload.selectedClass = FieldValue.delete();
        console.log(`[PayPalWebhook] AIO/Trial stacked for ${userId}, expires=${aioExpirationDate.toISOString()}`);
      } else if (plan === 'single' && className) {
        updatePayload.isAio = false;
        updatePayload.classEntitlements = {
          ...existingClasses,
          [className]: { expires: classExpirationTimestamp, updatedAt: FieldValue.serverTimestamp() }
        };
        console.log(`[PayPalWebhook] Single class=${className} stacked for ${userId}, expires=${classExpirationDate.toISOString()}`);
      }

      await userRef.set(updatePayload, { merge: true });

      await firestore.collection('orders').add({
        userId,
        email: existingData?.email || null,
        paypalEmail: resource?.payer?.email_address || null,
        plan,
        className: className || null,
        amount: paypalData.amount,
        currency: 'USD',
        source: 'paypal',
        paymentProvider: 'paypal',
        paymentStatus: 'completed',
        transactionId: captureId || null,
        orderId,
        subscriptionId: null,
        excludedFromRevenue: false,
        createdAt: FieldValue.serverTimestamp()
      });

      syncDiscord(userId, plan).catch((err: any) => console.error('[Discord Sync Error]', err));
      triggerLicenseSync(userId, 'paypal-webhook').catch((err: any) => console.error('[LicenseSync] Webhook sync failed:', err));

      console.log(`[PayPalWebhook] Completed processing ${orderId} for user ${userId}`);
    }
  } catch (err: any) {
    console.error('[PayPalWebhook] Processing error:', err);
    // 500, not 200: this is very likely transient (Firestore, PayPal API) -
    // PayPal will retry the webhook delivery on a non-2xx response, giving a
    // real second chance to recover instead of the payment silently going
    // unrecorded forever with no automatic retry at all.
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Processing error' });
    }
    return;
  }

  if (!res.headersSent) {
    res.status(200).json({ received: true });
  }
}
