import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../../_lib/body.js';
import { getDb, FieldValue } from '../../_lib/firebase-admin.js';
import { requireAdmin } from '../../_lib/auth.js';
import { syncKeyToGithub } from '../../_lib/github.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const body = await readJsonBody(req);
  const { userId, updates } = body || {};

  if (!userId || !updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'userId and updates object required' });
  }

  try {
    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(userId);

    const updatePayload: any = {
      ...updates,
      updatedAt: FieldValue.serverTimestamp()
    };

    // Remove legacy selectedClass if migrating
    if (updates.classEntitlements || updates.aioExpires) {
      updatePayload.selectedClass = FieldValue.delete();
    }

    await userRef.update(updatePayload);
    console.log(`[AdminUpdate] User ${userId} updated by ${caller.uid}`, updates);

    const needsSync = updates.plan !== undefined ||
      updates.accountStatus !== undefined ||
      updates.expiresAt !== undefined ||
      updates.aioExpires !== undefined ||
      updates.classEntitlements !== undefined;
    let githubResult = null;
    if (needsSync) {
      githubResult = await syncKeyToGithub(userId);
    }

    return res.status(200).json({ success: true, githubSync: githubResult });
  } catch (err: any) {
    console.error('[AdminUpdate] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
