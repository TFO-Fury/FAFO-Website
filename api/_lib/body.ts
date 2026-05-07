import type { VercelRequest } from '@vercel/node';

export async function readJsonBody(req: VercelRequest): Promise<any> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks).toString('utf-8');
  try {
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}
