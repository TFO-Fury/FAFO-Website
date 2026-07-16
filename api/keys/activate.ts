import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { syncDiscord } from '../_lib/discord.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { normalizeEntitlements, timestampToDate } from '../_lib/entitlements.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { key, userId } = body || {};
  console.log(`[API] Activate Key Request: ${key} for user ${userId}`);

  if (!key || !userId) {
    console.warn('[API] Missing key or userId in activation request');
    return res.status(400).json({ error: 'Key and userId required' });
  }

  try {
    const firestore = await getDb();
    const keyRef = firestore.collection('cd_keys').doc(key);
    const keySnap = await keyRef.get();

    // cd_keys are tracking identifiers (e.g. Battle.net IDs), not a source of
    // entitlement - they exist so access can be tied to and revoked from a
    // specific account/device. Linking one must NEVER grant or extend
    // access on its own. A previous version of this endpoint stacked 30
    // days of AIO onto the account for every activation, which meant a
    // customer could claim the free trial, immediately link any key, and
    // get a free 30-day extension - discovered when a real trial user's
    // key activation pushed their access out by a month. The account's
    // real plan/aioExpires/classEntitlements (set only by actual purchases,
    // trial claims, or admin edits) are the only source of truth for what a
    // customer can use; this endpoint only ever links/reports, never grants.
    if (keySnap.exists) {
      const keyData = keySnap.data()!;
      if (keyData.userId && keyData.userId !== userId) {
        console.warn(`[API] Key ${key} owned by ${keyData.userId}, but user ${userId} tried to activate it`);
        return res.status(400).json({ error: 'Key already used by another user' });
      }
      if (keyData.status === 'inactive') {
        console.warn(`[API] Deactivated key ${key} attempted by user ${userId}`);
        return res.status(400).json({ error: 'This key has been deactivated by an admin' });
      }
    }

    const userDoc = await firestore.collection('users').doc(userId).get();
    const existingUserData = userDoc.exists ? userDoc.data() : null;
    const normalized = normalizeEntitlements(existingUserData);

    await keyRef.set({
      key,
      userId,
      plan: normalized.plan, // informational snapshot only - never read to determine license validity
      status: 'active',
      lastUsedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(keySnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
    }, { merge: true });

    console.log(`[API] Key ${key} linked to ${userId}. Account's real plan: ${normalized.plan} (unchanged by this action).`);

    syncDiscord(userId, normalized.plan).catch(err => console.error('[Discord Sync Error]', err));

    let githubResult;
    let githubSyncFailed = false;
    try {
      githubResult = await triggerLicenseSync(userId, 'activation', key);
    } catch (syncErr: any) {
      console.error(`[LicenseSync] CRITICAL: triggerLicenseSync threw unexpectedly. This should never happen. Error:`, syncErr);
      githubResult = { success: false, error: syncErr.message || 'Unexpected GitHub sync crash' };
      githubSyncFailed = true;
    }

    const aioDate = timestampToDate(normalized.aioExpires);

    return res.status(200).json({
      success: true,
      activationSuccess: true,
      githubSyncFailed,
      githubSync: githubResult || { success: false, error: 'No result' },
      plan: normalized.plan,
      expiresAt: aioDate ? aioDate.toISOString() : null
    });
  } catch (err: any) {
    console.error('[Activation Error]', err);
    return res.status(500).json({ error: 'Server error during activation: ' + err.message });
  }
}
