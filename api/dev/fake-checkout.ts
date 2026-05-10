import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue, Timestamp } from '../_lib/firebase-admin.js';
import { syncDiscord } from '../_lib/discord.js';
import { requireAdmin } from '../_lib/auth.js';
import { triggerLicenseSync } from '../_lib/github.js';
import { normalizeEntitlements } from '../_lib/entitlements.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Enforce caller is admin or owner
  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const body = await readJsonBody(req);
  const { userId, email, planType, className } = body || {};

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
    const expirationTimestamp = Timestamp.fromDate(expirationDate);

    const userDoc = await firestore.collection('users').doc(userId).get();
    const existingData = userDoc.exists ? userDoc.data() : null;

    // Normalize old schema
    const normalized = normalizeEntitlements(existingData);
    console.log(`[DevCheckout] Normalized entitlements for ${userId}: plan=${normalized.plan}, classes=[${Object.keys(normalized.classEntitlements).join(', ')}], aio=${normalized.aioExpires ? 'yes' : 'no'}`);

    const updatePayload: any = {
      email: email || null,
      plan: planType,
      accountStatus: 'active',
      updatedAt: FieldValue.serverTimestamp(),
      ...(normalized.migrated ? { selectedClass: FieldValue.delete() } : {})
    };

    if (planType === 'aio' || planType === 'trial') {
      updatePayload.isAio = true;
      updatePayload.aioExpires = expirationTimestamp;
      // AIO fully replaces single-class entitlements
      updatePayload.classEntitlements = FieldValue.delete();
      console.log(`[DevCheckout] Granting AIO/Trial to ${userId}, aioExpires=${expirationDate.toISOString()}, cleared classEntitlements`);
    } else if (planType === 'single' && className) {
      updatePayload.isAio = false;
      updatePayload.classEntitlements = {
        ...normalized.classEntitlements,
        [className]: {
          expires: expirationTimestamp,
          updatedAt: FieldValue.serverTimestamp()
        }
      };
      console.log(`[DevCheckout] Granting single class=${className} to ${userId}, expires=${expirationDate.toISOString()}, totalClasses=${Object.keys(updatePayload.classEntitlements).length}`);
    } else {
      // Generic fallback
      updatePayload.expiresAt = expirationTimestamp;
      console.log(`[DevCheckout] Generic grant plan=${planType} to ${userId}, expires=${expirationDate.toISOString()}`);
    }

    await firestore.collection('users').doc(userId).set(updatePayload, { merge: true });

    // Create order entry (excluded from revenue)
    await firestore.collection('orders').add({
      userId,
      email: existingData?.email || email || null,
      plan: planType,
      className: className || null,
      amount: 0,
      currency: 'USD',
      source: 'admin-dev',
      paymentProvider: null,
      paymentStatus: 'completed',
      transactionId: null,
      subscriptionId: null,
      excludedFromRevenue: true,
      createdAt: FieldValue.serverTimestamp()
    });
    console.log(`[DevCheckout] Order entry created for ${userId}, excludedFromRevenue=true`);

    const discordResult = await syncDiscord(userId, planType);
    const githubResult = await triggerLicenseSync(userId, 'fake-checkout');

    return res.status(200).json({
      success: true,
      assignedPlan: planType,
      className: className || null,
      expirationDate: expirationDate.toISOString(),
      discordSyncResult: discordResult,
      githubSync: githubResult
    });
  } catch (err: any) {
    console.error('[DevCheckout] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
