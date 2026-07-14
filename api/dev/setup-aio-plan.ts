import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBaseUrl } from '../_lib/paypal.js';

// TEMPORARY one-off setup route — creates the PayPal Product + Billing Plan
// backing AIO subscriptions. Run once, record the returned planId as
// PAYPAL_AIO_PLAN_ID / VITE_PAYPAL_AIO_PLAN_ID, then delete this file.
async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    throw new Error(`OAuth failed: ${res.status} ${await res.text()}`);
  }
  const data: any = await res.json();
  return data.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const accessToken = await getAccessToken();
    const baseUrl = getBaseUrl();

    const productRes = await fetch(`${baseUrl}/v1/catalogs/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name: 'FAFO AIO Access',
        description: 'FAFO Rotations All-In-One subscription access',
        type: 'SERVICE',
        category: 'SOFTWARE'
      })
    });
    if (!productRes.ok) {
      return res.status(500).json({ step: 'create-product', error: await productRes.text() });
    }
    const product: any = await productRes.json();

    const planRes = await fetch(`${baseUrl}/v1/billing/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        product_id: product.id,
        name: 'FAFO AIO Access - Recurring (30 days)',
        description: '$35 every 30 days for full AIO access',
        billing_cycles: [
          {
            frequency: { interval_unit: 'DAY', interval_count: 30 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: '35.00', currency_code: 'USD' } }
          }
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: 'CONTINUE',
          payment_failure_threshold: 3
        }
      })
    });
    if (!planRes.ok) {
      return res.status(500).json({ step: 'create-plan', error: await planRes.text(), productId: product.id });
    }
    const plan: any = await planRes.json();

    return res.status(200).json({ success: true, productId: product.id, planId: plan.id, planStatus: plan.status });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Setup failed' });
  }
}
