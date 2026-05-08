import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { verifyWebhookSignature, capturePayPalOrder } from '../_lib/paypal.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { syncDiscord } from '../_lib/discord.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  const headers = req.headers;

  // Webhook verification
  const transmissionId = headers['paypal-transmission-id'] as string;
  const certId = headers['paypal-cert-id'] as string;
  const authAlgo = headers['paypal-auth-algo'] as string;
  const transmissionTime = headers['paypal-transmission-time'] as string;
  const transmissionSig = headers['paypal-transmission-sig'] as string;

  const verified = await verifyWebhookSignature(
    transmissionId, certId, authAlgo, transmissionTime, transmissionSig, body
  );

  if (!verified) {
    console.warn('[PayPalWebhook] Signature verification failed');
    return res.status(400).json({ error: 'Webhook verification failed' });
  }

  const eventType = body?.event_type;
  const resource = body?.resource;
  const orderId = resource?.id;

  console.log(`[PayPalWebhook] Received ${eventType} for order ${orderId}`);

  // Acknowledge immediately
  res.status(200).json({ received: true });

  // Process async
  try {
    const firestore = await getDb();
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
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + days);
      const expirationTimestamp = FieldValue.serverTimestamp(); // Use server timestamp

      const updatePayload: Record<string, any> = {
        plan,
        accountStatus: 'active',
        updatedAt: FieldValue.serverTimestamp()
      };

      if (plan === 'aio' || plan === 'trial') {
        updatePayload.isAio = true;
        updatePayload.aioExpires = expirationTimestamp;
        updatePayload.classEntitlements = FieldValue.delete();
        updatePayload.selectedClass = FieldValue.delete();
      } else if (plan === 'single' && className) {
        updatePayload.isAio = false;
        const existingClasses = existingData?.classEntitlements || {};
        updatePayload.classEntitlements = {
          ...existingClasses,
          [className]: { expires: expirationTimestamp, updatedAt: FieldValue.serverTimestamp() }
        };
      }

      await userRef.set(updatePayload, { merge: true });

      await firestore.collection('orders').add({
        userId,
        email: existingData?.email || resource?.payer?.email_address || null,
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

    if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
      const subscriptionId = resource?.id;
      if (!subscriptionId) {
        console.warn('[PayPalWebhook] Missing subscription ID in cancellation event');
        return;
      }

      // Find user with matching subscriptionId
      const usersQuery = await firestore.collection('users')
        .where('subscriptionId', '==', subscriptionId)
        .limit(1)
        .get();

      if (usersQuery.empty) {
        console.warn(`[PayPalWebhook] No user found for cancelled subscription ${subscriptionId}`);
        return;
      }

      const userRef = usersQuery.docs[0].ref;
      await userRef.set({
        subscriptionStatus: 'cancelled',
        subscriptionCancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`[PayPalWebhook] Subscription ${subscriptionId} marked as cancelled (entitlements preserved until expiration)`);
    }
  } catch (err: any) {
    console.error('[PayPalWebhook] Processing error:', err);
  }
}
