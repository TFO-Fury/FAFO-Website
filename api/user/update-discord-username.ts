import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { verifyIdToken } from '../_lib/auth.js';

// Self-service: lets a signed-in user set/clear their own self-reported
// Discord username. Only ever touches the caller's own document.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let decoded;
  try {
    decoded = await verifyIdToken(req);
  } catch (err: any) {
    return res.status(401).json({ error: err.message || 'Unauthorized' });
  }

  const body = await readJsonBody(req);
  const raw = typeof body?.discordUsername === 'string' ? body.discordUsername.trim() : '';

  if (raw.length > 64) {
    return res.status(400).json({ error: 'Discord username too long' });
  }

  try {
    const firestore = await getDb();
    await firestore.collection('users').doc(decoded.uid).set({
      discordUsername: raw || null,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('[UpdateDiscordUsername] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
