import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../../_lib/body.js';
import { getDb } from '../../_lib/firebase-admin.js';
import { syncDiscord } from '../../_lib/discord.js';
import { triggerLicenseSync } from '../../_lib/github.js';
import { requireAdmin } from '../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const body = await readJsonBody(req);
  const { userId } = body || {};
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    const firestore = await getDb();
    const userDoc = await firestore.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    await syncDiscord(userId, userDoc.data()?.plan || 'none');
    const githubResult = await triggerLicenseSync(userId, 'sync-roles');
    return res.status(200).json({ success: true, githubSync: githubResult });
  } catch (err: any) {
    console.error('[Sync Roles Error]', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
