import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { requireAdmin } from '../_lib/auth.js';
import { syncKeyToGithub } from '../_lib/github.js';
import { getDb } from '../_lib/firebase-admin.js';

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

  console.log(`[DevTest] Manual GitHub sync test for userId=${userId}`);

  const firestore = await getDb();
  const userDoc = await firestore.collection('users').doc(userId).get();
  const userData = userDoc.exists ? userDoc.data() : null;

  const result = await syncKeyToGithub(userId);

  return res.status(200).json({
    success: result.success,
    userId,
    user: userData
      ? {
          id: userId,
          plan: userData.plan,
          selectedClass: userData.selectedClass || null,
          accountStatus: userData.accountStatus,
          expiresAt: userData.expiresAt?.toDate?.()?.toISOString?.() || userData.expiresAt || null
        }
      : null,
    selectedKey: result.selectedKey || null,
    githubPath: result.path || null,
    githubStatus: result.githubStatus || null,
    sha: result.sha || null,
    error: result.error || null,
    githubResponse: result.githubResponse || null
  });
}
