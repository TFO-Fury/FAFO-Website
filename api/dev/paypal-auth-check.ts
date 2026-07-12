import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAuth } from '../_lib/paypal.js';

// TEMPORARY diagnostic route — confirms the stored PayPal credentials can
// authenticate against the configured PayPal API without creating an order
// or moving money. Remove after use.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const result = await checkAuth();
  return res.status(result.ok ? 200 : 502).json(result);
}
