import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { syncDiscord } from '../_lib/discord.js';
import { syncKeyToGithub } from '../_lib/github.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { key, userId, plan = 'aio' } = body || {};
  console.log(`[API] Activate Key Request: ${key} for user ${userId} (Plan: ${plan})`);

  if (!key || !userId) {
    console.warn('[API] Missing key or userId in activation request');
    return res.status(400).json({ error: 'Key and userId required' });
  }

  try {
    const firestore = await getDb();
    const keyRef = firestore.collection('cd_keys').doc(key);
    const keySnap = await keyRef.get();

    const days = plan === 'trial' ? 3 : 30;
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);

    console.log(`[API] Processing key ${key}. Exists: ${keySnap.exists}. Expiration: ${expirationDate.toISOString()}`);

    const batch = firestore.batch();

    if (keySnap.exists) {
      const keyData = keySnap.data();
      console.log(`[API] Existing key data:`, keyData);

      if (keyData?.userId && keyData.userId !== userId) {
        console.warn(`[API] Key ${key} owned by ${keyData.userId}, but user ${userId} tried to activate it`);
        return res.status(400).json({ error: 'Key already used by another user' });
      }
      if (keyData?.status === 'inactive') {
        console.warn(`[API] Deactivated key ${key} attempted by user ${userId}`);
        return res.status(400).json({ error: 'This key has been deactivated by an admin' });
      }

      batch.update(keyRef, {
        userId,
        status: 'active',
        lastUsedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } else {
      console.log(`[API] Creating new key record for ${key}`);
      batch.set(keyRef, {
        key,
        userId,
        plan,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        lastUsedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expirationDate)
      });
    }

    const userRef = firestore.collection('users').doc(userId);
    batch.set(userRef, {
      plan,
      accountStatus: 'active',
      isAio: plan === 'aio',
      expiresAt: Timestamp.fromDate(expirationDate),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await batch.commit();
    console.log(`[API] Successfully committed activation for user ${userId}`);

    syncDiscord(userId, plan).catch(err => console.error('[Discord Sync Error]', err));
    syncKeyToGithub(userId).then(result => {
      console.log(`[GitHubSync] Activation trigger result:`, result);
    }).catch(err => console.error('[GitHubSync] Activation trigger error:', err));

    return res.status(200).json({ success: true, plan, expiresAt: expirationDate });
  } catch (err: any) {
    console.error('[Activation Error]', err);
    return res.status(500).json({ error: 'Server error during activation: ' + err.message });
  }
}
