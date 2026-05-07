import type { VercelRequest } from '@vercel/node';

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function getAppUrl(req: VercelRequest) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');

  const protocol = getHeaderValue(req.headers['x-forwarded-proto']) || 'https';
  const host = getHeaderValue(req.headers['x-forwarded-host']) || req.headers.host;

  return `${protocol}://${host}`;
}
