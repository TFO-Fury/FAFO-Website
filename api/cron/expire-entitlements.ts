import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { timestampToDate } from '../_lib/entitlements.js';
import { revokeDiscordRoles } from '../_lib/discord.js';
import { triggerLicenseSync } from '../_lib/github.js';

function isNowExpired(userData: any): boolean {
  if (userData?.accountStatus !== 'active') return false;

  const now = new Date();
  const aioDate = timestampToDate(userData?.aioExpires);
  const aioActive = !!aioDate && aioDate > now;

  const classEntries = Object.entries(userData?.classEntitlements || {});
  const anyClassActive = classEntries.some(([, ent]: [string, any]) => {
    const d = timestampToDate(ent?.expires);
    return !!d && d > now;
  });

  const hadAnyEntitlement = !!userData?.aioExpires || classEntries.length > 0;

  return hadAnyEntitlement && !aioActive && !anyClassActive;
}

// Vercel Cron (see vercel.json) hits this once a day. Discord has no concept
// of an expiring role - a role granted at purchase time stays forever unless
// explicitly removed - so this is what actually revokes access once an
// entitlement's expiration date has passed.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const firestore = await getDb();
    const usersSnap = await firestore.collection('users').get();

    const expiredUsers = usersSnap.docs.filter(doc => isNowExpired(doc.data()));

    const results = [];
    for (const doc of expiredUsers) {
      const userId = doc.id;
      try {
        await doc.ref.set({
          accountStatus: 'expired',
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        const revokeResult = await revokeDiscordRoles(userId);
        const githubResult = await triggerLicenseSync(userId, 'expire-cron').catch((err: any) => {
          console.error(`[ExpireCron] License sync failed for ${userId}:`, err);
          return null;
        });

        console.log(`[ExpireCron] Expired ${userId} (${doc.data().email || 'no email'}), revoked=${JSON.stringify(revokeResult)}`);
        results.push({ userId, email: doc.data().email || null, revoked: revokeResult, githubSync: !!githubResult });
      } catch (err: any) {
        console.error(`[ExpireCron] Failed processing ${userId}:`, err);
        results.push({ userId, error: err.message });
      }
    }

    console.log(`[ExpireCron] Scanned ${usersSnap.size} users, expired ${results.length}`);
    return res.status(200).json({ success: true, scanned: usersSnap.size, expired: results.length, results });
  } catch (err: any) {
    console.error('[ExpireCron] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
