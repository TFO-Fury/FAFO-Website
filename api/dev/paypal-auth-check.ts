import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAuthBoth } from '../_lib/paypal.js';

// TEMPORARY diagnostic route — confirms the stored PayPal credentials can
// authenticate against live and/or sandbox PayPal without creating an order
// or moving money. Remove after use.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const result = await checkAuthBoth();
  return res.status(200).json(result);
}
