import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBaseUrl } from '../_lib/paypal.js';

// TEMPORARY read-only check: confirms the exact current status of the $1
// test plan on PayPal's side. Delete after use.
const TEST_PLAN_ID = 'P-7S765290LF179743PNJK3BSI';

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
  const data: any = await res.json();
  return data.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const accessToken = await getAccessToken();
    const baseUrl = getBaseUrl();

    const planRes = await fetch(`${baseUrl}/v1/billing/plans/${TEST_PLAN_ID}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const plan: any = await planRes.json();

    return res.status(200).json({
      id: plan.id,
      status: plan.status,
      name: plan.name
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
