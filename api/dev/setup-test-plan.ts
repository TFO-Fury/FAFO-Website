import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBaseUrl } from '../_lib/paypal.js';

// TEMPORARY one-off setup route — creates a $1/30-day test Billing Plan on
// the existing AIO product, for live end-to-end testing without charging
// the real $35 price. Delete this file once the test plan is created.
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

  const productId = 'PROD-6HD52758XD6032925';

  try {
    const accessToken = await getAccessToken();
    const baseUrl = getBaseUrl();

    const planRes = await fetch(`${baseUrl}/v1/billing/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        product_id: productId,
        name: 'FAFO AIO Access - TEST ($1)',
        description: 'TEMPORARY $1 test plan for live end-to-end verification - safe to deactivate/delete after testing',
        billing_cycles: [
          {
            frequency: { interval_unit: 'DAY', interval_count: 30 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: '1.00', currency_code: 'USD' } }
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
      return res.status(500).json({ step: 'create-test-plan', error: await planRes.text() });
    }
    const plan: any = await planRes.json();

    return res.status(200).json({ success: true, testPlanId: plan.id, planStatus: plan.status });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Setup failed' });
  }
}
