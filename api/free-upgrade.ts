import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from './_lib/body.js';
import { getDb, FieldValue, Timestamp } from './_lib/firebase-admin.js';
import { verifyIdToken } from './_lib/auth.js';
import { normalizeEntitlements, calculateStackedExpiration } from './_lib/entitlements.js';
import { computeExpectedAmount } from './_lib/pricing.js';
import { triggerLicenseSync } from './_lib/github.js';
import { syncDiscord } from './_lib/discord.js';

// Grants the AIO entitlement without going through PayPal, for the one case
// where the real price is $0: an existing Single-class holder upgrading to AIO
// now that both plans cost the same. Eligibility is re-derived server-side —
// never trust the client's claim that this is a free upgrade.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let decoded;
  try {
    decoded = await verifyIdToken(req);
  } catch (err: any) {
    return res.status(401).json({ error: err.message || 'Unauthorized' });
  }

  const body = await readJsonBody(req);
  const { userId } = body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  if (decoded.uid !== userId) {
    return res.status(403).json({ error: 'Cannot grant entitlements to another user' });
  }

  try {
    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    const normalized = normalizeEntitlements(userData);
    const expectedAmount = computeExpectedAmount('aio', normalized.plan);
    if (expectedAmount !== 0) {
      return res.status(400).json({ error: 'Not eligible for a free upgrade. Use standard checkout.' });
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
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await firestore.collection('orders').add({
      userId,
      email: userData?.email || decoded.email || null,
      plan: 'aio',
      className: null,
      amount: 0,
      currency: 'USD',
      source: 'free-upgrade',
      paymentProvider: null,
      paymentStatus: 'completed',
      transactionId: null,
      subscriptionId: null,
      excludedFromRevenue: true,
      createdAt: FieldValue.serverTimestamp()
    });

    syncDiscord(userId, 'aio').catch((err: any) => console.error('[FreeUpgrade] Discord sync error:', err));
    const githubResult = await triggerLicenseSync(userId, 'free-upgrade');

    console.log(`[FreeUpgrade] Granted free AIO upgrade for userId=${userId}, expires=${aioExpirationDate.toISOString()}`);

    return res.status(200).json({
      success: true,
      plan: 'aio',
      expiresAt: aioExpirationDate.toISOString(),
      githubSync: githubResult
    });
  } catch (err: any) {
    console.error('[FreeUpgrade] Error:', err);
    return res.status(500).json({ error: err.message || 'Free upgrade failed' });
  }
}
