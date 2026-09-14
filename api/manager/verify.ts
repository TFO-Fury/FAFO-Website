import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from '../_lib/body.js';
import { getDb, FieldValue } from '../_lib/firebase-admin.js';
import { normalizeEntitlements, isAioActive, getActiveClasses, timestampToDate } from '../_lib/entitlements.js';

// FAFO Manager reader "call home" check — the reader is a local, unsandboxed Python process
// (unlike the in-game Lua sandbox), so it can't trust a locally-editable license file. It POSTs
// { key, spec } here on startup and periodically during a run; this is the only source of truth,
// backed directly by Firestore rather than the licenses/*.json GitHub mirror (which can lag).
//
// Response is deliberately minimal: never echo back anything beyond this one spec's validity, so
// the endpoint can't be used to enumerate everything a key is entitled to.

// tools/specs.json's assetClass, lowercased, is the class key normalizeEntitlements() keys on.
const SPEC_TO_CLASS: Record<string, string> = {
  'Hunter-BeastMastery': 'hunter',
  'Hunter-Survival': 'hunter',
  'Hunter-Marksmanship': 'hunter',
  'DeathKnight-Unholy': 'deathknight',
  'DeathKnight-Frost': 'deathknight',
  'DeathKnight-Blood': 'deathknight',
  'Monk-Mistweaver': 'monk',
  'Monk-Windwalker': 'monk',
  'Monk-Brewmaster': 'monk',
  'Paladin-Holy': 'paladin',
  'Paladin-Retribution': 'paladin',
  'Paladin-Protection': 'paladin',
  'Priest-Discipline': 'priest',
  'Priest-Holy': 'priest',
  'Priest-Shadow': 'priest',
  'Warrior-Arms': 'warrior',
  'Warrior-Fury': 'warrior',
  'Warrior-Protection': 'warrior',
  'Warlock-Destruction': 'warlock',
  'Warlock-Affliction': 'warlock',
  'Warlock-Demonology': 'warlock',
  'DemonHunter-Havoc': 'demonhunter',
  'DemonHunter-Vengeance': 'demonhunter',
  'Evoker-Preservation': 'evoker',
  'Evoker-Devastation': 'evoker',
  'Evoker-Augmentation': 'evoker',
  'Shaman-Enhancement': 'shaman',
  'Shaman-Elemental': 'shaman',
  'Shaman-Restoration': 'shaman',
  'Druid-Guardian': 'druid',
  'Druid-Restoration': 'druid',
  'Druid-Feral': 'druid',
  'Druid-Balance': 'druid',
  'Mage-Fire': 'mage',
  'Mage-Arcane': 'mage',
  'Mage-Frost': 'mage',
  'Rogue-Assassination': 'rogue',
  'Rogue-Outlaw': 'rogue',
  'Rogue-Subtlety': 'rogue',
};

// Simple in-memory rate limiter (per-function-instance, best-effort for serverless) — same shape
// as api/sync-license.ts, keyed by license key rather than IP since this is an unauthenticated,
// widely-distributed desktop client rather than a single admin session.
const requestLog = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 40;

function isRateLimited(id: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const requests = requestLog.get(id) || [];
  const recent = requests.filter(t => t > windowStart);
  requestLog.set(id, [...recent, now]);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

// Matches the reader's RECHECK_SECONDS cadence (fafo/license.py) - two
// different devices legitimately checking in more than a day apart is just
// a device switch (reinstall, new PC), not simultaneous sharing.
const RECENT_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_DEVICE_FLAGS_KEPT = 20;

// Flag-only, no blocking yet (2026-09 decision: a customer's second PC or a
// reinstall shouldn't get wrongly locked out until we've seen real data and
// are comfortable with the false-positive rate). Records the most recent
// device per key and, when a DIFFERENT device shows up while the previous
// one was seen within the last ~24h, appends a review entry to
// cd_keys/{key}.deviceFlags so key-sharing surfaces in the admin CD Keys
// tab instead of only being noticed by accident. Fire-and-forget: must
// never slow down or fail the actual license response.
async function trackDevice(
  keyRef: FirebaseFirestore.DocumentReference,
  keyData: any,
  device: unknown
): Promise<void> {
  if (!device || typeof device !== 'string') return; // older client build, hasn't updated to send it yet

  const lastDeviceId: string | undefined = keyData?.lastDeviceId;
  const lastSeen = timestampToDate(keyData?.lastDeviceSeenAt);
  const now = new Date();

  const update: Record<string, any> = {
    lastDeviceId: device,
    lastDeviceSeenAt: FieldValue.serverTimestamp()
  };

  if (lastDeviceId && lastDeviceId !== device && lastSeen && (now.getTime() - lastSeen.getTime()) < RECENT_DEVICE_WINDOW_MS) {
    console.warn(`[ManagerVerify] Possible key sharing: key=${keyRef.id} device changed ${lastDeviceId} -> ${device} within ${RECENT_DEVICE_WINDOW_MS / 3600000}h`);
    const existingFlags: any[] = Array.isArray(keyData?.deviceFlags) ? keyData.deviceFlags : [];
    update.deviceFlags = [
      ...existingFlags,
      { previousDeviceId: lastDeviceId, newDeviceId: device, previousSeenAt: lastSeen.toISOString(), flaggedAt: now.toISOString() }
    ].slice(-MAX_DEVICE_FLAGS_KEPT);
  }

  await keyRef.set(update, { merge: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { key, spec, device } = body || {};

  if (!key || typeof key !== 'string' || !spec || typeof spec !== 'string') {
    return res.status(400).json({ valid: false, error: 'key and spec required' });
  }

  if (isRateLimited(key)) {
    console.warn(`[ManagerVerify] Rate limit exceeded for key=${key}`);
    return res.status(429).json({ valid: false, error: 'Too many requests' });
  }

  const wantClass = SPEC_TO_CLASS[spec];
  if (!wantClass) {
    return res.status(400).json({ valid: false, error: `Unknown spec '${spec}'` });
  }

  try {
    const firestore = await getDb();

    // Admin kill switch (Specs tab in AdminPanel) - lets a spec be pulled for
    // everyone instantly while a bug in it is being fixed, without needing a
    // per-customer explanation. Checked before the real entitlement check so
    // it applies regardless of what a given key is otherwise entitled to.
    const specsConfigSnap = await firestore.collection('config').doc('managerSpecs').get();
    if (specsConfigSnap.exists && specsConfigSnap.data()?.disabled?.[spec]) {
      return res.status(200).json({ valid: false, underConstruction: true });
    }

    const keySnap = await firestore.collection('cd_keys').doc(key).get();
    if (!keySnap.exists) {
      return res.status(200).json({ valid: false });
    }
    const keyData = keySnap.data();
    if (!keyData?.userId || keyData.status === 'inactive') {
      return res.status(200).json({ valid: false });
    }

    const userDoc = await firestore.collection('users').doc(keyData.userId).get();
    if (!userDoc.exists) {
      return res.status(200).json({ valid: false });
    }

    // A real key resolving to a real account is a genuine "call home" from
    // that customer's manager install, regardless of what the spec check
    // below decides - record it so the admin panel can show last-seen
    // instead of the rarely-useful Role column. Fire-and-forget: this must
    // never slow down or fail the actual license response.
    userDoc.ref.set({ lastManagerPingAt: FieldValue.serverTimestamp(), lastManagerPingSpec: spec }, { merge: true })
      .catch(err => console.error('[ManagerVerify] Failed to record lastManagerPingAt:', err));

    const normalized = normalizeEntitlements(userDoc.data());

    if (isAioActive(normalized)) {
      const expires = timestampToDate(normalized.aioExpires);
      trackDevice(keySnap.ref, keyData, device).catch(err => console.error('[ManagerVerify] Failed to track device:', err));
      return res.status(200).json({ valid: true, expires: expires!.toISOString() });
    }

    if (getActiveClasses(normalized).includes(wantClass)) {
      const expires = timestampToDate(normalized.classEntitlements[wantClass].expires);
      trackDevice(keySnap.ref, keyData, device).catch(err => console.error('[ManagerVerify] Failed to track device:', err));
      return res.status(200).json({ valid: true, expires: expires!.toISOString() });
    }

    return res.status(200).json({ valid: false });
  } catch (err: any) {
    console.error('[ManagerVerify] Error:', err);
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
}
