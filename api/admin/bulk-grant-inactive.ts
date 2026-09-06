import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { requireAdmin } from '../_lib/auth.js';
import { syncDiscord } from '../_lib/discord.js';
import { triggerLicenseSync } from '../_lib/github.js';

// Generous headroom for a full sweep across every inactive user (each does a
// Firestore write + a GitHub commit) - see api/paypal/webhook.ts's response-
// timing fix for why this response is never sent before all of it finishes.
export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  try {
    const firestore = await getDb();
    // Filtered in memory, matching the admin panel's own "Inactive" count
    // (users.filter(u => u.accountStatus !== 'active')) exactly - a Firestore
    // `!=` query would silently exclude any doc missing the field entirely.
    const usersSnap = await firestore.collection('users').get();
    const targets = usersSnap.docs.filter(d => d.data()?.accountStatus !== 'active');

    const hours = 48;
    const aioExpirationDate = new Date(Date.now() + hours * 60 * 60 * 1000);
    const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

    const results: any[] = [];
    for (const doc of targets) {
      const userId = doc.id;
      const userData = doc.data();
      try {
        await doc.ref.set({
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
          amount: 0,
          currency: 'USD',
          source: 'admin-bulk-reactivation',
          paymentProvider: null,
          paymentStatus: 'completed',
          transactionId: null,
          orderId: null,
          subscriptionId: null,
          excludedFromRevenue: true,
          createdAt: FieldValue.serverTimestamp()
        });

        const discordResult = await syncDiscord(userId, 'aio').catch((err: any) => ({ success: false, error: err.message }));
        const githubResult = await triggerLicenseSync(userId, 'admin-bulk-reactivation').catch((err: any) => ({ success: false, error: err.message }));

        results.push({ userId, email: userData?.email || null, success: true, discordResult, githubResult });
      } catch (err: any) {
        console.error(`[BulkGrantInactive] Failed for ${userId}:`, err);
        results.push({ userId, email: userData?.email || null, success: false, error: err.message });
      }
    }

    console.log(`[BulkGrantInactive] ${caller.uid} granted ${hours}h AIO to ${results.filter(r => r.success).length}/${targets.length} inactive users`);

    return res.status(200).json({
      success: true,
      totalInactive: targets.length,
      granted: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success),
      expiresAt: aioExpirationDate.toISOString()
    });
  } catch (err: any) {
    console.error('[BulkGrantInactive] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
