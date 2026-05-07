import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cert, initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const firebaseProjectId = (firebaseConfig as any).projectId as string;
const firestoreDatabaseId = (firebaseConfig as any).firestoreDatabaseId as string | undefined;

let db: Firestore | null = null;

function readServiceAccount(): any {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    try {
      return JSON.parse(envJson);
    } catch (e) {
      console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON env var', e);
      throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON environment variable');
    }
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json');
  if (!existsSync(serviceAccountPath)) {
    throw new Error(
      'Missing firebase-service-account.json in the project root. ' +
      'Download the Firebase Admin SDK private key JSON and place it next to server.ts, ' +
      'or set the FIREBASE_SERVICE_ACCOUNT_JSON environment variable.'
    );
  }
  return JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
}

export async function getDb(): Promise<Firestore> {
  if (!db) {
    try {
      const apps = getApps();
      if (apps.length === 0) {
        console.log(`[Firebase] Initializing Admin SDK with Project ID: ${firebaseProjectId}`);
        initializeApp({
          credential: cert(readServiceAccount()),
          projectId: firebaseProjectId,
        });
      }

      const firebaseApp = getApp();

      if (firestoreDatabaseId && firestoreDatabaseId !== '(default)' && firestoreDatabaseId !== firebaseProjectId) {
        console.log(`[Firebase] Connecting to Named Database Instance: "${firestoreDatabaseId}" in Project: "${firebaseProjectId}"`);
        db = getFirestore(firebaseApp, firestoreDatabaseId);
      } else {
        console.log(`[Firebase] Connecting to Default Database Instance in Project: "${firebaseProjectId}"`);
        db = getFirestore(firebaseApp);
      }

      try {
        await db.listCollections();
        console.log('[Firebase] Admin connection verified.');
      } catch (e) {
        console.error('[Firebase] Admin connection test failed:', e);
      }
    } catch (err) {
      console.error('[Firebase] getDb initialization error:', err);
      throw err;
    }
  }
  return db;
}

export { FieldValue, Timestamp };
