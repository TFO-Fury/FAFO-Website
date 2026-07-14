import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBaseUrl } from '../_lib/paypal.js';

// TEMPORARY one-off setup route — registers the PayPal webhook for this app.
// Run once, record the returned webhookId as PAYPAL_WEBHOOK_ID, then delete
// this file.
const WEBHOOK_URL = 'https://www.faforotations.shop/api/paypal/webhook';
const EVENT_TYPES = [
  'CHECKOUT.ORDER.APPROVED',
  'CHECKOUT.ORDER.COMPLETED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.SALE.COMPLETED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.EXPIRED'
];

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

    // Avoid creating a duplicate if one already exists for this URL.
    const listRes = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (listRes.ok) {
      const listData: any = await listRes.json();
      const existing = (listData.webhooks || []).find((w: any) => w.url === WEBHOOK_URL);
      if (existing) {
        return res.status(200).json({ success: true, reused: true, webhookId: existing.id, eventTypes: existing.event_types?.map((e: any) => e.name) });
      }
    }

    const createRes = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        event_types: EVENT_TYPES.map(name => ({ name }))
      })
    });
    if (!createRes.ok) {
      return res.status(500).json({ error: await createRes.text() });
    }
    const webhook: any = await createRes.json();

    return res.status(200).json({ success: true, webhookId: webhook.id, eventTypes: webhook.event_types?.map((e: any) => e.name) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Setup failed' });
  }
}
