import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { createPayPalOrder } from '../_lib/paypal.js';
import { isValidPlan, isValidClassName, computeExpectedAmount } from '../_lib/pricing.js';
import { normalizeEntitlements } from '../_lib/entitlements.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { userId, plan, className, amount } = body || {};

  if (!userId || !plan) {
    return res.status(400).json({ error: 'userId and plan required' });
  }

  if (!isValidPlan(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  if (plan === 'single' && !isValidClassName(className)) {
    return res.status(400).json({ error: 'Valid className required for single-class plan' });
  }

  try {
    const firestore = await getDb();
    const userSnap = await firestore.collection('users').doc(userId).get();
    const userData = userSnap.exists ? userSnap.data() : null;

    if (plan === 'trial' && userData?.trialUsed) {
      return res.status(400).json({ error: 'Trial already used' });
    }

    // Never trust the client-supplied amount — compute it server-side.
    const normalized = normalizeEntitlements(userData);
    const expectedAmount = computeExpectedAmount(plan, normalized.plan);
    if (String(amount) !== String(expectedAmount)) {
      console.warn(`[PayPal] Client-sent amount ($${amount}) did not match server-computed amount ($${expectedAmount}) for plan=${plan}, userId=${userId}. Using server-computed amount.`);
    }

    const description = plan === 'aio'
      ? 'FAFO All-In-One Subscription'
      : plan === 'trial'
        ? 'FAFO 3-Day Trial'
        : `FAFO Single Class (${className || 'unknown'})`;

    const order = await createPayPalOrder(
      String(expectedAmount),
      description,
      JSON.stringify({ userId, plan, className })
    );

    // Store order metadata for capture/webhook retrieval
    await firestore.collection('paypal_orders').doc(order.id).set({
      userId,
      plan,
      className: className || null,
      amount: expectedAmount,
      currency: 'USD',
      status: 'created',
      provider: 'paypal',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    console.log(`[PayPal] Order created: ${order.id} for user ${userId}, plan=${plan}`);
    return res.status(200).json({ success: true, orderId: order.id });
  } catch (err: any) {
    console.error('[PayPal] Create order error:', err);
    return res.status(500).json({ error: err.message || 'PayPal order creation failed' });
  }
}
