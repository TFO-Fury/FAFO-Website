import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/firebase-admin.js';
import { requireAdmin } from '../_lib/auth.js';

// Last 10 manager "call home" pings for one user (User Command Center's
// Recent Pings log) - written by api/manager/verify.ts to
// users/{userId}/pings. Plain orderBy on a subcollection, no composite index
// needed.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const userId = req.query.userId;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    const firestore = await getDb();
    const snap = await firestore.collection('users').doc(userId).collection('pings')
      .orderBy('at', 'desc')
      .limit(10)
      .get();

    const pings = snap.docs.map(doc => {
      const d = doc.data();
      const at = d.at?.toDate ? d.at.toDate() : (d.at ? new Date(d.at) : null);
      return { spec: d.spec || null, class: d.class || null, at: at ? at.toISOString() : null };
    });

    return res.status(200).json({ success: true, pings });
  } catch (err: any) {
    console.error('[AdminUserPings] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
