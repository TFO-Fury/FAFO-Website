import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { getAuth } from 'firebase-admin/auth';
import { requireAdmin } from '../_lib/auth.js';
import { removeKeyFromGithub } from '../_lib/github.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const body = await readJsonBody(req);
  const { userId, confirm } = body || {};

  if (!userId || confirm !== 'DELETE') {
    return res.status(400).json({ error: 'userId required and confirm must be DELETE' });
  }

  try {
    const firestore = await getDb();
    const auth = getAuth();

    const userDoc = await firestore.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const targetEmail = userData?.email || null;

    await firestore.collection('users').doc(userId).delete();

    const ordersSnapshot = await firestore.collection('orders')
      .where('userId', '==', userId)
      .get();
    const ordersBatch = firestore.batch();
    ordersSnapshot.docs.forEach(doc => ordersBatch.delete(doc.ref));
    await ordersBatch.commit();

    const purchasesSnapshot = await firestore.collection('purchases')
      .where('userId', '==', userId)
      .get();
    const purchasesBatch = firestore.batch();
    purchasesSnapshot.docs.forEach(doc => purchasesBatch.delete(doc.ref));
    await purchasesBatch.commit();

    const keysSnapshot = await firestore.collection('cd_keys')
      .where('userId', '==', userId)
      .get();

    // Remove GitHub licenses BEFORE deleting Firestore keys
    const githubRemovals = await Promise.all(
      keysSnapshot.docs.map(doc => removeKeyFromGithub(doc.id))
    );
    console.log(`[AdminDeleteUser] GitHub removals:`, githubRemovals.map(r => ({ success: r.success, path: r.path })));

    const keysBatch = firestore.batch();
    keysSnapshot.docs.forEach(doc => keysBatch.delete(doc.ref));
    await keysBatch.commit();

    try {
      await auth.deleteUser(userId);
    } catch (authErr: any) {
      console.warn(`[AdminDeleteUser] Auth delete failed for ${userId}:`, authErr.message);
    }

    await firestore.collection('admin_audit_log').add({
      adminUid: caller.uid,
      adminEmail: caller.email,
      targetUid: userId,
      targetEmail,
      action: 'deleted_user',
      timestamp: FieldValue.serverTimestamp()
    });

    return res.status(200).json({
      success: true,
      deleted: true,
      ordersDeleted: ordersSnapshot.size,
      purchasesDeleted: purchasesSnapshot.size,
      keysDeleted: keysSnapshot.size,
      githubRemovals
    });
  } catch (err: any) {
    console.error('[AdminDeleteUser] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
