import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb } from './firebase-admin.js';

export async function verifyIdToken(req: VercelRequest) {
  const header = req.headers.authorization || req.headers.Authorization;
  const authHeader = Array.isArray(header) ? header[0] : header;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new Error('Missing or invalid Authorization header');

  // Ensure Firebase Admin app is initialized before calling getAuth()
  await getDb();
  const auth = getAuth();
  return auth.verifyIdToken(token);
}

export async function requireAdmin(req: VercelRequest, res: VercelResponse) {
  try {
    const decoded = await verifyIdToken(req);
    const firestore = await getDb();
    const callerDoc = await firestore.collection('users').doc(decoded.uid).get();
    if (!callerDoc.exists) {
      res.status(403).json({ error: 'Forbidden: caller not found' });
      return null;
    }
    const callerData = callerDoc.data();
    const role = callerData?.role;
    if (role !== 'admin' && role !== 'owner') {
      res.status(403).json({ error: 'Forbidden: admin or owner role required' });
      return null;
    }
    return { uid: decoded.uid, email: decoded.email || callerData?.email, role, data: callerData };
  } catch (err: any) {
    console.error('[Auth] requireAdmin error:', err);
    res.status(401).json({ error: err.message || 'Unauthorized' });
    return null;
  }
}
