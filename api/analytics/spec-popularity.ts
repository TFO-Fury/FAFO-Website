import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/firebase-admin.js';
import { requireAdmin } from '../_lib/auth.js';
import { SPEC_TO_CLASS } from '../_lib/wow-classes.js';

// What % of recently-active players are on each spec, for the Analytics tab's
// Spec Popularity chart. "Active" = pinged the manager at least once in the
// window; a player who played 2 specs in the window counts toward both
// (percentages are "% of active players who touched this spec," not a strict
// partition, so they don't need to sum to 100%).
//
// Deliberately two steps instead of one collectionGroup query across every
// user's pings subcollection: (1) a cheap top-level range query on `users`
// (lastManagerPingAt, already written by verify.ts) to find who was active in
// the window at all, then (2) one small per-user subcollection read each.
// Both are automatic single-field indexes - a collectionGroup query here
// would need a manually-enabled collection-group index with no code path to
// set that up. At this user count the fan-out is cheap.

const WINDOW_DAYS = 7;
const DAY_MS = 86400000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  try {
    const firestore = await getDb();
    const cutoff = new Date(Date.now() - WINDOW_DAYS * DAY_MS);

    const activeUsersSnap = await firestore.collection('users')
      .where('lastManagerPingAt', '>=', cutoff)
      .get();

    const specCounts: Record<string, number> = {};
    for (const spec of Object.keys(SPEC_TO_CLASS)) specCounts[spec] = 0;

    let activePlayers = 0;
    await Promise.all(activeUsersSnap.docs.map(async userDoc => {
      const pingsSnap = await userDoc.ref.collection('pings')
        .where('at', '>=', cutoff)
        .get();
      if (pingsSnap.empty) return;

      const specsThisUser = new Set<string>();
      pingsSnap.docs.forEach(p => {
        const spec = p.data().spec;
        if (spec && Object.prototype.hasOwnProperty.call(specCounts, spec)) specsThisUser.add(spec);
      });
      if (specsThisUser.size === 0) return;

      activePlayers += 1;
      specsThisUser.forEach(spec => { specCounts[spec] += 1; });
    }));

    const specs = Object.entries(specCounts)
      .map(([spec, count]) => ({
        spec,
        class: SPEC_TO_CLASS[spec],
        players: count,
        percent: activePlayers > 0 ? Math.round((count / activePlayers) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.percent - a.percent || a.spec.localeCompare(b.spec));

    return res.status(200).json({ success: true, windowDays: WINDOW_DAYS, activePlayers, specs });
  } catch (err: any) {
    console.error('[SpecPopularity] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
