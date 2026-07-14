import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBaseUrl } from '../_lib/paypal.js';

// TEMPORARY one-off: deactivates the $1 test billing plan so it can no
// longer be used to create a subscription, even by a stale cached bundle.
// Delete this file after running once.
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

    const deactivateRes = await fetch(`${baseUrl}/v1/billing/plans/${TEST_PLAN_ID}/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!deactivateRes.ok && deactivateRes.status !== 204) {
      return res.status(500).json({ error: await deactivateRes.text() });
    }

    return res.status(200).json({ success: true, deactivatedPlanId: TEST_PLAN_ID });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Deactivation failed' });
  }
}
