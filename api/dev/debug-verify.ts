import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/firebase-admin.js';
import { normalizeEntitlements, isAioActive, getActiveClasses, timestampToDate } from '../_lib/entitlements.js';

// Temporary diagnostic to directly reproduce a specific key+spec check
// against the live Firestore data, bypassing rate limiting and log access,
// to determine ground truth without guessing.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const key = (req.query.key as string || '').toUpperCase();
  const spec = req.query.spec as string || 'Warrior-Fury';

  try {
    const firestore = await getDb();
    const keySnap = await firestore.collection('cd_keys').doc(key).get();
    if (!keySnap.exists) {
      return res.status(200).json({ result: 'key not found', key });
    }
    const keyData = keySnap.data();

    const specsConfigSnap = await firestore.collection('config').doc('managerSpecs').get();
    const specDisabled = specsConfigSnap.exists && specsConfigSnap.data()?.disabled?.[spec];

    if (!keyData?.userId || keyData.status === 'inactive') {
      return res.status(200).json({ result: 'key inactive or no userId', keyData: { status: keyData?.status, userId: keyData?.userId, lastDeviceId: keyData?.lastDeviceId, deviceFlags: keyData?.deviceFlags } });
    }

    const userDoc = await firestore.collection('users').doc(keyData.userId).get();
    if (!userDoc.exists) {
      return res.status(200).json({ result: 'user not found', userId: keyData.userId });
    }

    const userData = userDoc.data();
    const normalized = normalizeEntitlements(userData);
    const aioActive = isAioActive(normalized);
    const aioExpires = timestampToDate(normalized.aioExpires);

    return res.status(200).json({
      result: 'diagnostic',
      key,
      spec,
      specDisabled,
      keyStatus: keyData.status,
      keyUserId: keyData.userId,
      lastDeviceId: keyData.lastDeviceId,
      lastDeviceSeenAt: keyData.lastDeviceSeenAt?.toDate?.()?.toISOString() || null,
      deviceFlags: keyData.deviceFlags || [],
      userEmail: userData?.email,
      normalizedPlan: normalized.plan,
      aioActive,
      aioExpires: aioExpires?.toISOString() || null,
      activeClasses: getActiveClasses(normalized),
      wouldReturnValid: !specDisabled && (aioActive || getActiveClasses(normalized).includes(spec.split('-')[0].toLowerCase()))
    });
  } catch (err: any) {
    console.error('[DebugVerify] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
