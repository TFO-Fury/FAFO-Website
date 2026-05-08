import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { createPayPalOrder } from '../_lib/paypal.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { userId, plan, className, amount } = body || {};

  if (!userId || !plan || !amount) {
    return res.status(400).json({ error: 'userId, plan, and amount required' });
  }

  try {
    const description = plan === 'aio'
      ? 'FAFO All-In-One Subscription'
      : plan === 'trial'
        ? 'FAFO 3-Day Trial'
        : `FAFO Single Class (${className || 'unknown'})`;

    const order = await createPayPalOrder(
      String(amount),
      description,
      JSON.stringify({ userId, plan, className })
    );

    // Store order metadata for capture/webhook retrieval
    const firestore = await getDb();
    await firestore.collection('paypal_orders').doc(order.id).set({
      userId,
      plan,
      className: className || null,
      amount,
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
