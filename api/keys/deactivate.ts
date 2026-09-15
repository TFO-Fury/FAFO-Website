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
  const { keyId } = body || {};

  if (!keyId || typeof keyId !== 'string') {
    return res.status(400).json({ error: 'keyId required' });
  }

  try {
    const firestore = await getDb();
    const keyRef = firestore.collection('cd_keys').doc(keyId);
    const keySnap = await keyRef.get();

    if (!keySnap.exists) {
      return res.status(404).json({ error: 'Key not found' });
    }

    const previousUserId = keySnap.data()?.userId || null;
    const now = FieldValue.serverTimestamp();

    await keyRef.update({ status: 'inactive', updatedAt: now });

    // Remove the license file so the reader's "call home" check (api/manager/verify.ts)
    // and the licenses/*.json GitHub mirror both stop honoring the key immediately.
    // A missing GitHub token/owner/repo is a benign, already-reported skip (same shape
    // syncKeyToGithub uses) rather than a real failure worth blocking the admin on.
    const githubRemoval = await removeKeyFromGithub(keyId);
    const githubNotConfigured = githubRemoval.error === 'Missing GitHub credentials';
    if (!githubRemoval.success && !githubNotConfigured) {
      console.error(`[KeyDeactivate] GitHub removal failed for key ${keyId}:`, githubRemoval);
      return res.status(502).json({
        error: `Key marked inactive, but license file removal failed: ${githubRemoval.error || 'unknown error'}. Try again.`,
        githubRemoval
      });
    }

    // Re-sync the owner's remaining entitlements (other active keys, if any) after removal.
    const githubSync = previousUserId ? await triggerLicenseSync(previousUserId, 'key-deactivation') : null;

    await firestore.collection('admin_audit_log').add({
      adminUid: caller.uid,
      adminEmail: caller.email || null,
      targetUid: previousUserId,
      keyId,
      action: 'deactivated_key',
      timestamp: now
    });

    console.log(`[KeyDeactivate] Key ${keyId} deactivated by ${caller.email} (previousUserId=${previousUserId || 'none'})`);

    return res.status(200).json({
      success: true,
      keyId,
      previousUserId,
      githubRemoval,
      githubSync
    });
  } catch (err: any) {
    console.error('[KeyDeactivate] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
