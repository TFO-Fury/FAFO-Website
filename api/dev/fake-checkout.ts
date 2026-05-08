import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { syncDiscord } from '../_lib/discord.js';
import { requireAdmin } from '../_lib/auth.js';
import { syncKeyToGithub } from '../_lib/github.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Enforce caller is admin or owner
  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const body = await readJsonBody(req);
  const { userId, email, planType, selectedClass: reqSelectedClass } = body || {};

  if (!userId || !planType) {
    return res.status(400).json({ error: 'userId and planType are required' });
  }

  if (!['aio', 'single', 'trial'].includes(planType)) {
    return res.status(400).json({ error: 'Invalid planType. Must be aio, single, or trial' });
  }

  try {
    const firestore = await getDb();
    const days = planType === 'trial' ? 3 : 30;
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);

    const userDoc = await firestore.collection('users').doc(userId).get();
    const existingData = userDoc.exists ? userDoc.data() : null;

    let selectedClass = reqSelectedClass;
    if (!selectedClass && existingData?.selectedClass) {
      selectedClass = existingData.selectedClass;
    }
    if (planType === 'aio') {
      selectedClass = 'all';
    }

    const updatePayload: any = {
      email: email || null,
      plan: planType,
      accountStatus: 'active',
      isAio: planType === 'aio',
      expiresAt: Timestamp.fromDate(expirationDate),
      updatedAt: FieldValue.serverTimestamp()
    };
    if (selectedClass) updatePayload.selectedClass = selectedClass;

    await firestore.collection('users').doc(userId).set(updatePayload, { merge: true });

    console.log(`[DevCheckout] Granted ${planType} to user ${userId}, expires ${expirationDate.toISOString()}`);

    const discordResult = await syncDiscord(userId, planType);
    const githubResult = await syncKeyToGithub(userId);

    return res.status(200).json({
      success: true,
      assignedPlan: planType,
      expirationDate: expirationDate.toISOString(),
      discordSyncResult: discordResult
    });
  } catch (err: any) {
    console.error('[DevCheckout] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
