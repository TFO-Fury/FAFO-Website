import { Timestamp, FieldValue } from './firebase-admin.js';

export interface ClassEntitlement {
  expires: any; // Timestamp or Date
  updatedAt: any;
}

export interface NormalizedEntitlements {
  classEntitlements: Record<string, ClassEntitlement>;
  aioExpires: any;
  plan: string;
  migrated: boolean;
}

export function timestampToDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts.toDate && typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

export function normalizeEntitlements(userData: any): NormalizedEntitlements {
  let classEntitlements: Record<string, ClassEntitlement> = {};
  let aioExpires: any = null;
  let plan = userData?.plan || 'none';
  let migrated = false;

  // Migrate existing classEntitlements if present
  if (userData?.classEntitlements && typeof userData.classEntitlements === 'object') {
    classEntitlements = { ...userData.classEntitlements };
  }

  // Migrate legacy selectedClass + expiresAt into classEntitlements
  if (userData?.selectedClass && !classEntitlements[userData.selectedClass]) {
    const expires = timestampToDate(userData.expiresAt);
    if (expires) {
      classEntitlements[userData.selectedClass] = {
        expires: userData.expiresAt,
        updatedAt: userData.updatedAt || FieldValue.serverTimestamp()
      };
      migrated = true;
      console.log(`[Entitlements] Migrated legacy selectedClass=${userData.selectedClass} into classEntitlements`);
    }
  }

  // Migrate legacy AIO plan into aioExpires
  if ((plan === 'aio' || plan === 'trial') && userData?.expiresAt && !userData?.aioExpires) {
    aioExpires = userData.expiresAt;
    migrated = true;
    console.log(`[Entitlements] Migrated legacy plan=${plan} expiresAt into aioExpires`);
  }

  // If aioExpires already exists separately, use it
  if (userData?.aioExpires) {
    aioExpires = userData.aioExpires;
  }

  // Derive plan from actual entitlements if ambiguous
  const hasAio = !!aioExpires && timestampToDate(aioExpires) && timestampToDate(aioExpires)! > new Date();
  const hasClasses = Object.keys(classEntitlements).length > 0;
  const anyActiveClass = hasClasses && Object.entries(classEntitlements).some(
    ([, v]) => timestampToDate(v.expires) && timestampToDate(v.expires)! > new Date()
  );

  if (hasAio) {
    plan = 'aio';
  } else if (anyActiveClass) {
    plan = 'single';
  } else if (hasClasses) {
    plan = 'single';
  } else {
    plan = 'none';
  }

  return { classEntitlements, aioExpires, plan, migrated };
}

export function buildLicensePayload(
  key: string,
  normalized: NormalizedEntitlements
): Record<string, any> {
  const payload: Record<string, any> = {
    key,
    updatedAt: new Date().toISOString()
  };

  if (normalized.aioExpires) {
    const aioDate = timestampToDate(normalized.aioExpires);
    if (aioDate) payload.aioExpires = aioDate.toISOString();
  }

  if (Object.keys(normalized.classEntitlements).length > 0) {
    payload.classEntitlements = {};
    for (const [cls, ent] of Object.entries(normalized.classEntitlements)) {
      const d = timestampToDate(ent.expires);
      if (d) {
        payload.classEntitlements[cls] = { expires: d.toISOString() };
      }
    }
  }

  return payload;
}

export function isAioActive(normalized: NormalizedEntitlements): boolean {
  const d = timestampToDate(normalized.aioExpires);
  return !!d && d > new Date();
}

export function getActiveClasses(normalized: NormalizedEntitlements): string[] {
  const now = new Date();
  return Object.entries(normalized.classEntitlements)
    .filter(([, v]) => {
      const d = timestampToDate(v.expires);
      return !!d && d > now;
    })
    .map(([k]) => k);
}
