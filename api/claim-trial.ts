import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from './_lib/body.js';
import { getDb, FieldValue, Timestamp } from './_lib/firebase-admin.js';
import { verifyIdToken } from './_lib/auth.js';
import { calculateStackedExpiration } from './_lib/entitlements.js';
import { triggerLicenseSync } from './_lib/github.js';
import { syncDiscord } from './_lib/discord.js';

class ClaimError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Grants the 3-day free trial. Server-side only - the client never gets to
// claim eligibility itself. Requires Discord to already be linked so the
// per-Discord-account dedup below can't be sidestepped by linking Discord
// only after claiming on a fresh email.
//
// Abuse prevention: a trial claim atomically reserves both a
// trialClaims/email_{email} and trialClaims/discord_{discordId} document.
// If either already exists (from any account, not just this one), the claim
// is rejected - closing both "new email each time" and "same Discord, new
// email" abuse patterns.
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
    return res.status(403).json({ error: 'Cannot claim a trial for another user' });
  }

  try {
    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(userId);

    const { aioExpirationDate, discordId } = await firestore.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : null;

      if (userData?.trialUsed) {
        throw new ClaimError(400, 'Trial already used on this account.');
      }

      const discordId = userData?.discordId;
      if (!discordId) {
        throw new ClaimError(400, 'Link your Discord account before claiming a trial.');
      }

      const email = (userData?.email || decoded.email || '').trim().toLowerCase();
      if (!email) {
        throw new ClaimError(400, 'A verified email is required to claim a trial.');
      }

      const emailClaimRef = firestore.collection('trialClaims').doc(`email_${email}`);
      const discordClaimRef = firestore.collection('trialClaims').doc(`discord_${discordId}`);

      const [emailClaimSnap, discordClaimSnap] = await Promise.all([
        tx.get(emailClaimRef),
        tx.get(discordClaimRef)
      ]);

      if (emailClaimSnap.exists) {
        throw new ClaimError(400, 'This email has already used a free trial.');
      }
      if (discordClaimSnap.exists) {
        throw new ClaimError(400, 'This Discord account has already used a free trial.');
      }

      const aioExpirationDate = calculateStackedExpiration(userData?.aioExpires, 3);
      const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

      tx.set(emailClaimRef, { userId, discordId, claimedAt: FieldValue.serverTimestamp() });
      tx.set(discordClaimRef, { userId, email, claimedAt: FieldValue.serverTimestamp() });
      tx.set(userRef, {
        plan: 'trial',
        isAio: true,
        accountStatus: 'active',
        trialUsed: true,
        aioExpires: aioExpirationTimestamp,
        classEntitlements: FieldValue.delete(),
        selectedClass: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return { aioExpirationDate, discordId };
    });

    await firestore.collection('orders').add({
      userId,
      email: decoded.email || null,
      plan: 'trial',
      className: null,
      amount: 0,
      currency: 'USD',
      source: 'trial-claim',
      paymentProvider: null,
      paymentStatus: 'completed',
      transactionId: null,
      subscriptionId: null,
      excludedFromRevenue: true,
      createdAt: FieldValue.serverTimestamp()
    });

    syncDiscord(userId, 'trial').catch((err: any) => console.error('[ClaimTrial] Discord sync error:', err));
    const githubResult = await triggerLicenseSync(userId, 'claim-trial');

    console.log(`[ClaimTrial] Granted trial for userId=${userId}, discordId=${discordId}, expires=${aioExpirationDate.toISOString()}`);

    return res.status(200).json({
      success: true,
      plan: 'trial',
      expiresAt: aioExpirationDate.toISOString(),
      githubSync: githubResult
    });
  } catch (err: any) {
    if (err instanceof ClaimError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[ClaimTrial] Error:', err);
    return res.status(500).json({ error: err.message || 'Trial claim failed' });
  }
}
