import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { requireAdmin } from '../_lib/auth.js';
import { triggerLicenseSync, removeKeyFromGithub } from '../_lib/github.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const body = await readJsonBody(req);
  const { userId, action } = body || {};

  if (!userId || !['disable', 'enable'].includes(action)) {
    return res.status(400).json({ error: 'userId and action (disable|enable) required' });
  }

  try {
    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data()!;
    const now = FieldValue.serverTimestamp();

    if (action === 'disable') {
      await userRef.update({
        accountStatus: 'disabled',
        disabledAt: now,
        disabledState: {
          plan: userData.plan || 'none',
          isAio: userData.isAio || false,
          aioExpires: userData.aioExpires || null,
          classEntitlements: userData.classEntitlements || {},
          selectedClass: userData.selectedClass || null,
          subscriptionId: userData.subscriptionId || null,
          subscriptionStatus: userData.subscriptionStatus || null,
          accountStatus: userData.accountStatus || 'active'
        },
        plan: 'none',
        isAio: false,
        aioExpires: null,
        classEntitlements: {},
        selectedClass: null,
        subscriptionId: null,
        subscriptionStatus: null,
        updatedAt: now
      });

      const keysSnapshot = await firestore.collection('cd_keys')
        .where('userId', '==', userId)
        .get();

      const batch = firestore.batch();
      keysSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, { status: 'revoked', updatedAt: now });
      });
      await batch.commit();

      // Remove licenses from GitHub for all user keys
      const githubRemovals = await Promise.all(
        keysSnapshot.docs.map(doc => removeKeyFromGithub(doc.id))
      );
      console.log(`[AdminDisableUser] GitHub removals:`, githubRemovals.map(r => ({ success: r.success, path: r.path })));

      await firestore.collection('admin_audit_log').add({
        adminUid: caller.uid,
        adminEmail: caller.email,
        targetUid: userId,
        targetEmail: userData.email || null,
        action: 'disabled_user',
        timestamp: now
      });

      return res.status(200).json({
        success: true,
        action: 'disable',
        accountStatus: 'disabled',
        keysRevoked: keysSnapshot.size,
        githubRemovals
      });
    } else {
      const disabledState = userData.disabledState || {};

      await userRef.update({
        accountStatus: disabledState.accountStatus || 'active',
        plan: disabledState.plan || 'none',
        isAio: disabledState.isAio || false,
        aioExpires: disabledState.aioExpires || null,
        classEntitlements: disabledState.classEntitlements || {},
        selectedClass: disabledState.selectedClass || null,
        subscriptionId: disabledState.subscriptionId || null,
        subscriptionStatus: disabledState.subscriptionStatus || null,
        disabledAt: FieldValue.delete(),
        disabledState: FieldValue.delete(),
        updatedAt: now
      });

      // Re-sync GitHub license for restored user
      const githubResult = await triggerLicenseSync(userId, 'enable');
      console.log(`[AdminDisableUser] GitHub re-sync on enable:`, githubResult);

      await firestore.collection('admin_audit_log').add({
        adminUid: caller.uid,
        adminEmail: caller.email,
        targetUid: userId,
        targetEmail: userData.email || null,
        action: 'enabled_user',
        timestamp: now
      });

      return res.status(200).json({
        success: true,
        action: 'enable',
        accountStatus: disabledState.accountStatus || 'active',
        githubSync: githubResult
      });
    }
  } catch (err: any) {
    console.error(`[AdminDisableUser] Error ${action}:`, err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
