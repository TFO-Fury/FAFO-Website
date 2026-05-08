const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

export function getClientId(): string | undefined {
  return PAYPAL_CLIENT_ID;
}

export function getBaseUrl(): string {
  return PAYPAL_BASE_URL;
}

async function getAccessToken(): Promise<string> {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('Missing PayPal credentials');
  }
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  return data.access_token;
}

export async function createPayPalOrder(amount: string, description: string, customId: string) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'USD', value: amount },
        description,
        custom_id: customId
      }]
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal create order failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<any>;
}

export async function capturePayPalOrder(orderId: string) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal capture failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<any>;
}

export async function verifyWebhookSignature(
  transmissionId: string,
  certId: string,
  authAlgo: string,
  transmissionTime: string,
  transmissionSig: string,
  body: any
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.warn('[PayPal] No PAYPAL_WEBHOOK_ID set, skipping webhook verification');
    return true;
  }
  try {
    const accessToken = await getAccessToken();
    const res = await fetch(`${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_id: certId,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: body
      })
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[PayPal] Webhook verification API error: ${res.status} ${text}`);
      return false;
    }
    const data: any = await res.json();
    return data.verification_status === 'SUCCESS';
  } catch (err: any) {
    console.error('[PayPal] Webhook verification exception:', err);
    return false;
  }
}
