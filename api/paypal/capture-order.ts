import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { capturePayPalOrder } from '../_lib/paypal.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { syncDiscord } from '../_lib/discord.js';
import { calculateStackedExpiration, timestampToDate } from '../_lib/entitlements.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { orderId, userId } = body || {};

  if (!orderId || !userId) {
    return res.status(400).json({ error: 'orderId and userId required' });
  }

  try {
    const firestore = await getDb();
    const paypalOrderRef = firestore.collection('paypal_orders').doc(orderId);
    const paypalOrderSnap = await paypalOrderRef.get();

    if (!paypalOrderSnap.exists) {
      return res.status(404).json({ error: 'PayPal order not found' });
    }

    const paypalData = paypalOrderSnap.data()!;
    if (paypalData.userId !== userId) {
      return res.status(403).json({ error: 'Order does not belong to user' });
    }

    const captureResult = await capturePayPalOrder(orderId);
    const status = captureResult?.status;

    if (status !== 'COMPLETED') {
      await paypalOrderRef.update({
        status: status || 'failed',
        captureResult: JSON.stringify(captureResult),
        updatedAt: FieldValue.serverTimestamp()
      });
      return res.status(400).json({ success: false, error: `PayPal capture status: ${status}` });
    }

    const plan = paypalData.plan;
    const className = paypalData.className;
    const amount = paypalData.amount;
    const payerEmail = captureResult?.payer?.email_address || null;
    const transactionId = captureResult?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

    // DEDUPLICATION: check if this transactionId or orderId already processed
    if (transactionId) {
      const dupCheck = await firestore.collection('orders')
        .where('transactionId', '==', transactionId)
        .limit(1)
        .get();
      if (!dupCheck.empty) {
        console.log(`[PayPalCapture] Deduplication: transactionId=${transactionId} already processed, skipping`);
        return res.status(200).json({ success: true, deduplicated: true, transactionId });
      }
    }
    const dupCheckOrder = await firestore.collection('orders')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();
    if (!dupCheckOrder.empty) {
      console.log(`[PayPalCapture] Deduplication: orderId=${orderId} already processed, skipping`);
      return res.status(200).json({ success: true, deduplicated: true, orderId });
    }

    const days = plan === 'trial' ? 3 : 30;

    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const existingData = userDoc.exists ? userDoc.data() : null;
    const existingClasses = existingData?.classEntitlements || {};

    // Calculate stacked expiration for AIO
    const prevAioExp = timestampToDate(existingData?.aioExpires);
    const aioExpirationDate = calculateStackedExpiration(existingData?.aioExpires, days);
    const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

    // Calculate stacked expiration for the specific single class
    const prevClassExp = timestampToDate(existingClasses[className]?.expires);
    const classExpirationDate = calculateStackedExpiration(existingClasses[className]?.expires, days);
    const classExpirationTimestamp = Timestamp.fromDate(classExpirationDate);

    console.log(`[PayPalCapture] duration=${days}d, prevAio=${prevAioExp?.toISOString() || 'none'}, prevClass=${prevClassExp?.toISOString() || 'none'}, now=${new Date().toISOString()}, newAio=${aioExpirationDate.toISOString()}, newClass=${classExpirationDate.toISOString()}`);

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
      console.log(`[PayPalCapture] AIO/Trial stacked for ${userId}, expires=${aioExpirationDate.toISOString()}`);
    } else if (plan === 'single' && className) {
      updatePayload.isAio = false;
      updatePayload.classEntitlements = {
        ...existingClasses,
        [className]: {
          expires: classExpirationTimestamp,
          updatedAt: FieldValue.serverTimestamp()
        }
      };
      console.log(`[PayPalCapture] Single class=${className} stacked for ${userId}, expires=${classExpirationDate.toISOString()}`);
    } else {
      updatePayload.expiresAt = aioExpirationTimestamp;
    }

    await userRef.set(updatePayload, { merge: true });

    // Create order entry
    await firestore.collection('orders').add({
      userId,
      email: existingData?.email || null,
      paypalEmail: payerEmail || null,
      plan,
      className: className || null,
      amount,
      currency: 'USD',
      source: 'paypal',
      paymentProvider: 'paypal',
      paymentStatus: 'completed',
      transactionId,
      orderId,
      subscriptionId: null,
      excludedFromRevenue: false,
      createdAt: FieldValue.serverTimestamp()
    });

    await paypalOrderRef.update({
      status: 'completed',
      transactionId,
      updatedAt: FieldValue.serverTimestamp()
    });

    // Non-blocking syncs
    syncDiscord(userId, plan).catch((err: any) => console.error('[Discord Sync Error]', err));
    const githubResult = await triggerLicenseSync(userId, 'paypal-capture');

    return res.status(200).json({
      success: true,
      plan,
      expiresAt: (plan === 'single' && className ? classExpirationDate : aioExpirationDate).toISOString(),
      className: className || null,
      githubSync: githubResult
    });
  } catch (err: any) {
    console.error('[PayPalCapture] Error:', err);
    return res.status(500).json({ error: err.message || 'Capture failed' });
  }
}
