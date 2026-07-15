import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { syncDiscord } from '../_lib/discord.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { normalizeEntitlements, timestampToDate, calculateStackedExpiration } from '../_lib/entitlements.js';
import { isValidPlan, isValidClassName } from '../_lib/pricing.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { key, userId, className: reqClassName } = body || {};
  console.log(`[API] Activate Key Request: ${key} for user ${userId}`);

  if (!key || !userId) {
    console.warn('[API] Missing key or userId in activation request');
    return res.status(400).json({ error: 'Key and userId required' });
  }

  try {
    const firestore = await getDb();
    const keyRef = firestore.collection('cd_keys').doc(key);
    const keySnap = await keyRef.get();

    // Keys are issued externally, never generated through this site - so
    // activation can only ever redeem a key that already exists, using the
    // plan it was actually issued with. Never trust a client-supplied plan:
    // a nonexistent key used to just get silently created on the spot with
    // whatever plan the request claimed, which meant anyone could POST a
    // made-up key string with plan: 'aio' and get free access.
    if (!keySnap.exists) {
      console.warn(`[API] Activation attempted with unknown key ${key} by user ${userId}`);
      return res.status(400).json({ error: 'Invalid key' });
    }

    const keyData = keySnap.data()!;

    if (keyData.userId && keyData.userId !== userId) {
      console.warn(`[API] Key ${key} owned by ${keyData.userId}, but user ${userId} tried to activate it`);
      return res.status(400).json({ error: 'Key already used by another user' });
    }
    if (keyData.status === 'inactive') {
      console.warn(`[API] Deactivated key ${key} attempted by user ${userId}`);
      return res.status(400).json({ error: 'This key has been deactivated by an admin' });
    }
    if (!isValidPlan(keyData.plan)) {
      console.error(`[API] Key ${key} has an invalid/missing plan in Firestore: ${keyData.plan}`);
      return res.status(400).json({ error: 'This key is misconfigured. Contact support.' });
    }

    const plan = keyData.plan;

    // Read existing user metadata to preserve/stack entitlements
    const userDoc = await firestore.collection('users').doc(userId).get();
    const existingUserData = userDoc.exists ? userDoc.data() : null;
    const normalized = normalizeEntitlements(existingUserData);

    // A key can come pre-bound to a specific class (set when it was issued),
    // or be a generic single-class key where the class is chosen at
    // activation - still validated against the real class list, never
    // trusted verbatim. Falls back to renewing the user's existing single
    // class if neither is present.
    const existingSingleClass = Object.keys(normalized.classEntitlements).length === 1
      ? Object.keys(normalized.classEntitlements)[0]
      : null;
    const className = plan === 'single'
      ? (keyData.className || (isValidClassName(reqClassName) ? reqClassName : null) || existingSingleClass)
      : null;

    if (plan === 'single' && !className) {
      return res.status(400).json({ error: 'A valid class name is required for this key' });
    }

    console.log(`[API] Key ${key} resolved: plan=${plan}, className=${className || '(none)'}`);

    const days = plan === 'trial' ? 3 : 30;

    const prevAioExp = timestampToDate(existingUserData?.aioExpires);
    const aioExpirationDate = calculateStackedExpiration(existingUserData?.aioExpires, days);
    const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

    const prevClassExp = timestampToDate(className ? normalized.classEntitlements[className]?.expires : null);
    const classExpirationDate = calculateStackedExpiration(
      className ? normalized.classEntitlements[className]?.expires : null,
      days
    );
    const classExpirationTimestamp = Timestamp.fromDate(classExpirationDate);

    console.log(`[API] duration=${days}d, prevAio=${prevAioExp?.toISOString() || 'none'}, prevClass=${prevClassExp?.toISOString() || 'none'}, now=${new Date().toISOString()}, newAio=${aioExpirationDate.toISOString()}, newClass=${classExpirationDate.toISOString()}`);

    const batch = firestore.batch();

    batch.update(keyRef, {
      userId,
      status: 'active',
      lastUsedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    const userRef = firestore.collection('users').doc(userId);

    if (plan === 'aio' || plan === 'trial') {
      batch.set(userRef, {
        plan,
        accountStatus: 'active',
        isAio: true,
        aioExpires: aioExpirationTimestamp,
        updatedAt: FieldValue.serverTimestamp(),
        classEntitlements: FieldValue.delete(),
        ...(normalized.migrated || existingUserData?.selectedClass ? { selectedClass: FieldValue.delete() } : {})
      }, { merge: true });
      console.log(`[API] AIO/Trial activation: stacked aioExpires=${aioExpirationDate.toISOString()}, cleared classEntitlements`);
    } else {
      const classEntitlements = {
        ...normalized.classEntitlements,
        [className!]: {
          expires: classExpirationTimestamp,
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
      console.log(`[API] Single-class activation: class=${className}, expires=${classExpirationDate.toISOString()}, totalClasses=${Object.keys(classEntitlements).length}`);
    }

    await batch.commit();
    console.log(`[API] Activation committed. userId=${userId}, plan=${plan}, className=${className || '(none)'}`);

    syncDiscord(userId, plan).catch(err => console.error('[Discord Sync Error]', err));

    let githubResult;
    let githubSyncFailed = false;
    try {
      githubResult = await triggerLicenseSync(userId, 'activation', key);
    } catch (syncErr: any) {
      console.error(`[LicenseSync] CRITICAL: triggerLicenseSync threw unexpectedly. This should never happen. Error:`, syncErr);
      githubResult = { success: false, error: syncErr.message || 'Unexpected GitHub sync crash' };
      githubSyncFailed = true;
    }

    return res.status(200).json({
      success: true,
      activationSuccess: true,
      githubSyncFailed,
      githubSync: githubResult || { success: false, error: 'No result' },
      plan,
      expiresAt: (plan === 'single' ? classExpirationDate : aioExpirationDate).toISOString(),
      className: className || null
    });
  } catch (err: any) {
    console.error('[Activation Error]', err);
    return res.status(500).json({ error: 'Server error during activation: ' + err.message });
  }
}
