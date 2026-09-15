import { WOW_CLASSES } from './pricing.js';

// The admin panel and the licenses/*.json mirror both write a class key, but not the same
// spelling: the admin panel writes the squashed form ('deathknight'), while legacy storefront
// data and the licenses JSON use the spaced form ('death knight'). Both must resolve to the
// same canonical (spaced) class name so entitlement checks aren't spelling-sensitive.
const CLASS_ALIASES: Record<string, string> = {
  deathknight: 'death knight',
  demonhunter: 'demon hunter',
};

export function canonicalClassName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[_\-/]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const canonical = CLASS_ALIASES[normalized] ?? normalized;
  return WOW_CLASSES.includes(canonical) ? canonical : null;
}

export function timestampToDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts.toDate && typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

// tools/specs.json's assetClass is the key here (see FAFO-Manager). Values are the canonical
// spaced class names ('death knight', 'demon hunter', ...) and are matched against Firestore's
// classEntitlements keys spelling-insensitively via canonicalClassName, since existing data uses
// both the spaced and squashed spellings.
export const SPEC_TO_CLASS: Record<string, string> = {
  'Hunter-BeastMastery': 'hunter',
  'Hunter-Survival': 'hunter',
  'Hunter-Marksmanship': 'hunter',
  'DeathKnight-Unholy': 'death knight',
  'DeathKnight-Frost': 'death knight',
  'DeathKnight-Blood': 'death knight',
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
  'DemonHunter-Havoc': 'demon hunter',
  'DemonHunter-Vengeance': 'demon hunter',
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

export function classForSpec(spec: string): string | null {
  return Object.prototype.hasOwnProperty.call(SPEC_TO_CLASS, spec) ? SPEC_TO_CLASS[spec] : null;
}

/**
 * Resolves the latest still-active expiry for a spec's class, tolerant of both the spaced and
 * squashed class-key spellings Firestore's classEntitlements has accumulated. Never indexes the
 * map directly, so a null/undefined entry for a matching key can't throw.
 */
export function activeClassExpiryForSpec(
  classEntitlements: Record<string, any> | null | undefined,
  spec: string,
  now: Date = new Date()
): Date | null {
  const wantClass = classForSpec(spec);
  if (!wantClass || !classEntitlements) return null;

  let latest: Date | null = null;
  for (const [key, ent] of Object.entries(classEntitlements)) {
    if (canonicalClassName(key) !== wantClass) continue;
    const d = timestampToDate(ent?.expires);
    if (d && d > now && (!latest || d > latest)) {
      latest = d;
    }
  }
  return latest;
}
