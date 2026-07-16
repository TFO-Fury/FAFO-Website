import type { VercelRequest, VercelResponse } from '@vercel/node';
import { removeKeyFromGithub } from '../_lib/github.js';

// TEMPORARY: removes the license file created by the activate.ts
// verification test. Delete after use.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await removeKeyFromGithub('zzz-claude-test-trial-key-delete-me');
  return res.status(200).json(result);
}
