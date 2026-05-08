import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { syncDiscord } from '../_lib/discord.js';
import { syncKeyToGithub } from '../_lib/github.js';
import { normalizeEntitlements, timestampToDate } from '../_lib/entitlements.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { key, userId, plan: reqPlan, className: reqClassName } = body || {};
  console.log(`[API] Activate Key Request: ${key} for user ${userId} (reqPlan: ${reqPlan || '(none)'}, className: ${reqClassName || '(none)'})`);

  if (!key || !userId) {
    console.warn('[API] Missing key or userId in activation request');
    return res.status(400).json({ error: 'Key and userId required' });
  }

  try {
    const firestore = await getDb();
    const keyRef = firestore.collection('cd_keys').doc(key);
    const keySnap = await keyRef.get();

    // Read existing user metadata FIRST to preserve entitlements
    const userDoc = await firestore.collection('users').doc(userId).get();
    const existingUserData = userDoc.exists ? userDoc.data() : null;

    // Normalize old schema into new entitlements
    const normalized = normalizeEntitlements(existingUserData);
    console.log(`[API] Normalized entitlements before activation: plan=${normalized.plan}, classes=[${Object.keys(normalized.classEntitlements).join(', ')}], aio=${normalized.aioExpires ? 'yes' : 'no'}`);

    // Determine plan: explicit request > existing normalized plan > default 'none'
    const plan = reqPlan || normalized.plan;
    console.log(`[API] Plan resolution: existing=${normalized.plan}, req=${reqPlan || '(none)'}, resolved=${plan}`);

    const days = plan === 'trial' ? 3 : 30;
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);
    const expirationTimestamp = Timestamp.fromDate(expirationDate);

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
        updatedAt: FieldValue.serverTimestamp(),
        ...(reqClassName ? { className: reqClassName } : {})
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
        expiresAt: expirationTimestamp,
        ...(reqClassName ? { className: reqClassName } : {})
      });
    }

    const userRef = firestore.collection('users').doc(userId);

    if (plan === 'aio' || plan === 'trial') {
      // AIO or trial: update aioExpires, preserve classEntitlements
      batch.set(userRef, {
        plan,
        accountStatus: 'active',
        isAio: true,
        aioExpires: expirationTimestamp,
        updatedAt: FieldValue.serverTimestamp(),
        // Preserve existing classEntitlements and migrate if needed
        classEntitlements: normalized.classEntitlements,
        ...(normalized.migrated ? { selectedClass: FieldValue.delete() } : {})
      }, { merge: true });
      console.log(`[API] AIO/Trial activation: setting aioExpires=${expirationDate.toISOString()}, preserving ${Object.keys(normalized.classEntitlements).length} class entitlements`);
    } else if (plan === 'single' && reqClassName) {
      // Single class activation: add/update only this class
      const classEntitlements = {
        ...normalized.classEntitlements,
        [reqClassName]: {
          expires: expirationTimestamp,
          updatedAt: FieldValue.serverTimestamp()
        }
      };
      batch.set(userRef, {
        plan: 'single',
        accountStatus: 'active',
        isAio: false,
        classEntitlements,
        updatedAt: FieldValue.serverTimestamp(),
        ...(normalized.migrated ? { selectedClass: FieldValue.delete() } : {})
      }, { merge: true });
      console.log(`[API] Single-class activation: added/updated class=${reqClassName}, expires=${expirationDate.toISOString()}, totalClasses=${Object.keys(classEntitlements).length}`);
    } else if (plan === 'single' && Object.keys(normalized.classEntitlements).length === 1) {
      // Single plan, no explicit class, exactly one existing class: renew it
      const existingClass = Object.keys(normalized.classEntitlements)[0];
      const classEntitlements = {
        ...normalized.classEntitlements,
        [existingClass]: {
          expires: expirationTimestamp,
          updatedAt: FieldValue.serverTimestamp()
        }
      };
      batch.set(userRef, {
        plan: 'single',
        accountStatus: 'active',
        isAio: false,
        classEntitlements,
        updatedAt: FieldValue.serverTimestamp(),
        ...(normalized.migrated ? { selectedClass: FieldValue.delete() } : {})
      }, { merge: true });
      console.log(`[API] Single-class renewal: renewed class=${existingClass}, expires=${expirationDate.toISOString()}`);
    } else {
      // Fallback: generic activation without specific class info
      batch.set(userRef, {
        plan,
        accountStatus: 'active',
        isAio: plan === 'aio',
        expiresAt: expirationTimestamp,
        updatedAt: FieldValue.serverTimestamp(),
        ...(normalized.migrated ? { selectedClass: FieldValue.delete() } : {})
      }, { merge: true });
      console.log(`[API] Generic activation: plan=${plan}, expiresAt=${expirationDate.toISOString()}`);
    }

    await batch.commit();
    console.log(`[API] Activation committed. userId=${userId}, plan=${plan}, className=${reqClassName || '(none)'}`);

    // Verify key is readable before GitHub sync
    console.log(`[API] Verifying key ${key} is readable in Firestore...`);
    const keyVerify = await firestore.collection('cd_keys').doc(key).get();
    console.log(`[API] Post-commit key read: exists=${keyVerify.exists}, id=${keyVerify.id}, data=${JSON.stringify(keyVerify.data())}`);

    syncDiscord(userId, plan).catch(err => console.error('[Discord Sync Error]', err));

    let githubResult;
    let githubSyncFailed = false;
    try {
      githubResult = await syncKeyToGithub(userId, key);
      console.log(`[GitHubSync] Activation trigger result:`, githubResult);
    } catch (syncErr: any) {
      console.error(`[GitHubSync] CRITICAL: syncKeyToGithub threw unexpectedly. This should never happen. Error:`, syncErr);
      githubResult = { success: false, error: syncErr.message || 'Unexpected GitHub sync crash' };
      githubSyncFailed = true;
    }

    return res.status(200).json({
      success: true,
      activationSuccess: true,
      githubSyncFailed,
      githubSync: githubResult || { success: false, error: 'No result' },
      plan,
      expiresAt: expirationDate,
      className: reqClassName || null
    });
  } catch (err: any) {
    console.error('[Activation Error]', err);
    return res.status(500).json({ error: 'Server error during activation: ' + err.message });
  }
}
