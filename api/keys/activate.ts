import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { syncDiscord } from '../_lib/discord.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { normalizeEntitlements, timestampToDate, calculateStackedExpiration } from '../_lib/entitlements.js';
import { isValidClassName } from '../_lib/pricing.js';

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

    // cd_keys documents are device/installation identifiers, not prepaid
    // codes - manager/verify.ts never reads a key's own plan/status for
    // license validity, only keyData.userId to look up the account's real
    // entitlements. So linking a brand-new key here is legitimate and must
    // keep working. What must NEVER happen is trusting a plan from the
    // request body or from the key doc itself to decide what to grant -
    // that was the actual vulnerability (anyone could POST a made-up key
    // with plan: "aio" in the body and get free access). The only source of
    // truth for what to grant is the account's own existing entitlements.
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

    // Read existing user metadata to preserve/stack entitlements
    const userDoc = await firestore.collection('users').doc(userId).get();
    const existingUserData = userDoc.exists ? userDoc.data() : null;
    const normalized = normalizeEntitlements(existingUserData);
    const plan = normalized.plan;

    const existingSingleClass = Object.keys(normalized.classEntitlements).length === 1
      ? Object.keys(normalized.classEntitlements)[0]
      : null;
    const className = plan === 'single'
      ? ((isValidClassName(reqClassName) ? reqClassName : null) || existingSingleClass)
      : null;

    console.log(`[API] Key ${key} resolved from account's own entitlements: plan=${plan}, className=${className || '(none)'}`);

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

    batch.set(keyRef, {
      key,
      userId,
      plan,
      status: 'active',
      lastUsedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(keySnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      ...(className ? { className } : {})
    }, { merge: true });

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
    } else if (plan === 'single' && className) {
      const classEntitlements = {
        ...normalized.classEntitlements,
        [className]: {
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
    } else {
      // plan === 'none': nothing to grant. Still link the key to the account
      // (harmless - the manager will correctly report no active license via
      // this account's real entitlements) so the device is registered for
      // whenever they do purchase.
      console.log(`[API] Key ${key} linked to ${userId} with no active plan - nothing to grant.`);
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
      expiresAt: (plan === 'single' && className ? classExpirationDate : aioExpirationDate).toISOString(),
      className: className || null
    });
  } catch (err: any) {
    console.error('[Activation Error]', err);
    return res.status(500).json({ error: 'Server error during activation: ' + err.message });
  }
}
