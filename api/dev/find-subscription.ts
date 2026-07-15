import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBaseUrl } from '../_lib/paypal.js';

// TEMPORARY read-only diagnostic: searches recent PayPal transactions for
// subscription payments so we can reconcile a customer who was charged but
// never got their entitlement (confirm-subscription never ran). Delete
// after use.
async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data: any = await res.json();
  return data.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const accessToken = await getAccessToken();
    const baseUrl = getBaseUrl();

    const startDate = (req.query.start as string) || '2026-07-14T00:00:00-0300';
    const endDate = (req.query.end as string) || '2026-07-16T00:00:00-0300';

    const txRes = await fetch(
      `${baseUrl}/v1/reporting/transactions?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&fields=all&page_size=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!txRes.ok) {
      return res.status(500).json({ error: await txRes.text() });
    }

    const txData: any = await txRes.json();
    const transactions = (txData.transaction_details || []).map((t: any) => ({
      transaction_id: t.transaction_info?.transaction_id,
      transaction_event_code: t.transaction_info?.transaction_event_code,
      amount: t.transaction_info?.transaction_amount,
      date: t.transaction_info?.transaction_initiation_date,
      status: t.transaction_info?.transaction_status,
      paypal_reference_id: t.transaction_info?.paypal_reference_id,
      paypal_reference_id_type: t.transaction_info?.paypal_reference_id_type,
      custom_field: t.transaction_info?.custom_field,
      payer_name: t.payer_info?.payer_name,
      payer_email: t.payer_info?.email_address
    }));

    return res.status(200).json({ count: transactions.length, transactions });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Search failed' });
  }
}
