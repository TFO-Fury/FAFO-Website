import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { calculateStackedExpiration } from '../_lib/entitlements.js';
import { syncDiscord } from '../_lib/discord.js';
import { triggerLicenseSync } from '../_lib/github.js';

// TEMPORARY one-off remediation: grants AIO access to a specific customer
// who was charged twice via PayPal but never got their entitlement because
// confirm-subscription.ts failed to complete for both charges (root cause
// fixed separately in api/paypal/webhook.ts's self-healing fallback). One
// of the two charges has already been refunded by the site owner. Delete
// after use.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const firestore = await getDb();
    const usersSnap = await firestore.collection('users').where('email', '==', 'pedrosampaiomed@gmail.com').limit(1).get();
    if (usersSnap.empty) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userDoc = usersSnap.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();

    const days = 30;
    const aioExpirationDate = calculateStackedExpiration(userData?.aioExpires, days);
    const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

    await userDoc.ref.set({
      plan: 'aio',
      isAio: true,
      accountStatus: 'active',
      aioExpires: aioExpirationTimestamp,
      classEntitlements: FieldValue.delete(),
      selectedClass: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await firestore.collection('orders').add({
      userId,
      email: userData?.email || null,
      plan: 'aio',
      className: null,
      amount: 35,
      currency: 'USD',
      source: 'manual-reconciliation',
      paymentProvider: 'paypal',
      paymentStatus: 'completed',
      transactionId: null,
      orderId: null,
      subscriptionId: null,
      excludedFromRevenue: false,
      note: 'Customer charged twice on 2026-07-15 via PayPal subscription; confirm-subscription.ts failed both times (fixed via webhook self-healing fallback). One charge refunded by site owner. This entry manually grants the 30 days actually paid for.',
      createdAt: FieldValue.serverTimestamp()
    });

    const discordResult = await syncDiscord(userId, 'aio');
    const githubResult = await triggerLicenseSync(userId, 'manual-reconciliation');

    return res.status(200).json({
      success: true,
      userId,
      expiresAt: aioExpirationDate.toISOString(),
      discordResult,
      githubResult
    });
  } catch (err: any) {
    console.error('[ReconcilePedro] Error:', err);
    return res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
}
