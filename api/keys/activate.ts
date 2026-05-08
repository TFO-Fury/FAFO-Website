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
  const { key, userId, plan: reqPlan, selectedClass: reqSelectedClass } = body || {};
  console.log(`[API] Activate Key Request: ${key} for user ${userId} (reqPlan: ${reqPlan || '(none)'})`);

  if (!key || !userId) {
    console.warn('[API] Missing key or userId in activation request');
    return res.status(400).json({ error: 'Key and userId required' });
  }

  try {
    const firestore = await getDb();
    const keyRef = firestore.collection('cd_keys').doc(key);
    const keySnap = await keyRef.get();

    // Read existing user metadata FIRST to preserve plan and selectedClass
    const userDoc = await firestore.collection('users').doc(userId).get();
    const existingUserData = userDoc.exists ? userDoc.data() : null;
    const existingPlan = existingUserData?.plan || 'none';
    const existingSelectedClass = existingUserData?.selectedClass || null;

    // Preserve existing plan unless explicitly overridden in request
    const plan = reqPlan || existingPlan;
    console.log(`[API] Plan resolution: existingPlan=${existingPlan}, reqPlan=${reqPlan || '(none)'}, resolved=${plan}`);

    const days = plan === 'trial' ? 3 : 30;
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);

    console.log(`[API] Processing key ${key}. Exists: ${keySnap.exists}. Expiration: ${expirationDate.toISOString()}`);

    let selectedClass = reqSelectedClass;
    if (!selectedClass && keySnap.exists) {
      const keyData = keySnap.data();
      selectedClass = keyData?.selectedClass;
    }
    if (!selectedClass && existingSelectedClass) {
      selectedClass = existingSelectedClass;
    }
    if (plan === 'aio') {
      selectedClass = 'all';
    }

    console.log(`[API] selectedClass resolution: existing=${existingSelectedClass || '(none)'}, req=${reqSelectedClass || '(none)'}, resolved=${selectedClass || '(none)'}`);

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
        updatedAt: FieldValue.serverTimestamp(),
        ...(selectedClass ? { selectedClass } : {})
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
        expiresAt: Timestamp.fromDate(expirationDate),
        ...(selectedClass ? { selectedClass } : {})
      });
    }

    const userRef = firestore.collection('users').doc(userId);
    batch.set(userRef, {
      plan,
      accountStatus: 'active',
      isAio: plan === 'aio',
      expiresAt: Timestamp.fromDate(expirationDate),
      updatedAt: FieldValue.serverTimestamp(),
      ...(selectedClass ? { selectedClass } : {})
    }, { merge: true });

    await batch.commit();
    console.log(`[API] Activation committed. userId=${userId}, previousPlan=${existingPlan}, previousSelectedClass=${existingSelectedClass || '(none)'}, updatedPlan=${plan}, updatedSelectedClass=${selectedClass || '(none)'}`);

    // Verify key is readable before GitHub sync
    console.log(`[API] Verifying key ${key} is readable in Firestore...`);
    const keyVerify = await firestore.collection('cd_keys').doc(key).get();
    console.log(`[API] Post-commit key read: exists=${keyVerify.exists}, id=${keyVerify.id}, data=${JSON.stringify(keyVerify.data())}`);

    syncDiscord(userId, plan).catch(err => console.error('[Discord Sync Error]', err));
    const githubResult = await syncKeyToGithub(userId, key);
    console.log(`[GitHubSync] Activation trigger result:`, githubResult);

    return res.status(200).json({ success: true, plan, expiresAt: expirationDate });
  } catch (err: any) {
    console.error('[Activation Error]', err);
    return res.status(500).json({ error: 'Server error during activation: ' + err.message });
  }
}
