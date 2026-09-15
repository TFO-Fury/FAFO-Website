import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalClassName,
  timestampToDate,
  SPEC_TO_CLASS,
  classForSpec,
  activeClassExpiryForSpec,
} from './wow-classes.js';

const NOW = new Date('2026-09-15T00:00:00Z');
const FUTURE = new Date('2026-10-01T00:00:00Z');
const LATER_FUTURE = new Date('2026-11-01T00:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');

test('canonicalClassName: death knight spellings all normalize to "death knight"', () => {
  for (const value of ['death knight', 'deathknight', 'DeathKnight', 'Death Knight', 'death_knight', 'death-knight', 'DEATHKNIGHT']) {
    assert.equal(canonicalClassName(value), 'death knight', `expected ${value} -> 'death knight'`);
  }
});

test('canonicalClassName: demon hunter spellings all normalize to "demon hunter"', () => {
  for (const value of ['demon hunter', 'demonhunter', 'DemonHunter', 'Demon Hunter', 'demon_hunter']) {
    assert.equal(canonicalClassName(value), 'demon hunter', `expected ${value} -> 'demon hunter'`);
  }
});

test('canonicalClassName: a plain single-word class passes through', () => {
  assert.equal(canonicalClassName('hunter'), 'hunter');
});

test('canonicalClassName: unknown or non-string input returns null', () => {
  for (const value of ['paladinn', '', null, undefined, 42]) {
    assert.equal(canonicalClassName(value), null, `expected ${JSON.stringify(value)} -> null`);
  }
});

test('SPEC_TO_CLASS: every value is already canonical', () => {
  for (const [spec, cls] of Object.entries(SPEC_TO_CLASS)) {
    assert.equal(canonicalClassName(cls), cls, `SPEC_TO_CLASS['${spec}'] = '${cls}' is not canonical`);
  }
});

test('SPEC_TO_CLASS: has exactly 39 entries', () => {
  assert.equal(Object.keys(SPEC_TO_CLASS).length, 39);
});

test('classForSpec: resolves DeathKnight and DemonHunter specs to the spaced class names', () => {
  assert.equal(classForSpec('DeathKnight-Unholy'), 'death knight');
  assert.equal(classForSpec('DemonHunter-Havoc'), 'demon hunter');
});

test('classForSpec: unknown spec returns null', () => {
  assert.equal(classForSpec('Nope-X'), null);
});

test('classForSpec: prototype-chain keys are not treated as specs', () => {
  assert.equal(classForSpec('toString'), null);
});

test('activeClassExpiryForSpec: death knight specs match every death knight key spelling', () => {
  for (const key of ['death knight', 'deathknight', 'DeathKnight']) {
    const classEntitlements = { [key]: { expires: FUTURE } };
    for (const spec of ['DeathKnight-Blood', 'DeathKnight-Frost', 'DeathKnight-Unholy']) {
      assert.deepEqual(activeClassExpiryForSpec(classEntitlements, spec, NOW), FUTURE);
    }
  }
});

test('activeClassExpiryForSpec: demon hunter specs match every demon hunter key spelling', () => {
  for (const key of ['demon hunter', 'demonhunter', 'DemonHunter']) {
    const classEntitlements = { [key]: { expires: FUTURE } };
    for (const spec of ['DemonHunter-Havoc', 'DemonHunter-Vengeance']) {
      assert.deepEqual(activeClassExpiryForSpec(classEntitlements, spec, NOW), FUTURE);
    }
  }
});

test('activeClassExpiryForSpec: expired entry returns null', () => {
  const classEntitlements = { deathknight: { expires: PAST } };
  assert.equal(activeClassExpiryForSpec(classEntitlements, 'DeathKnight-Blood', NOW), null);
});

test('activeClassExpiryForSpec: an unrelated class does not satisfy a different spec', () => {
  assert.equal(activeClassExpiryForSpec({ hunter: { expires: FUTURE } }, 'DemonHunter-Havoc', NOW), null);
  assert.equal(activeClassExpiryForSpec({ 'demon hunter': { expires: FUTURE } }, 'Hunter-Survival', NOW), null);
});

test('activeClassExpiryForSpec: both spellings present picks the later date regardless of key order', () => {
  const forward = { deathknight: { expires: FUTURE }, 'death knight': { expires: LATER_FUTURE } };
  assert.deepEqual(activeClassExpiryForSpec(forward, 'DeathKnight-Blood', NOW), LATER_FUTURE);

  const reversed = { 'death knight': { expires: LATER_FUTURE }, deathknight: { expires: FUTURE } };
  assert.deepEqual(activeClassExpiryForSpec(reversed, 'DeathKnight-Blood', NOW), LATER_FUTURE);
});

test('activeClassExpiryForSpec: accepts Date, ISO string, and Firestore-style Timestamp expires', () => {
  assert.deepEqual(
    activeClassExpiryForSpec({ deathknight: { expires: FUTURE } }, 'DeathKnight-Blood', NOW),
    FUTURE
  );
  assert.deepEqual(
    activeClassExpiryForSpec({ deathknight: { expires: FUTURE.toISOString() } }, 'DeathKnight-Blood', NOW),
    FUTURE
  );
  assert.deepEqual(
    activeClassExpiryForSpec({ deathknight: { expires: { toDate: () => FUTURE } } }, 'DeathKnight-Blood', NOW),
    FUTURE
  );
});

test('activeClassExpiryForSpec: an unparsable expires string returns null', () => {
  assert.equal(activeClassExpiryForSpec({ deathknight: { expires: 'garbage' } }, 'DeathKnight-Blood', NOW), null);
});

test('activeClassExpiryForSpec: missing or malformed entitlement data never throws', () => {
  assert.equal(activeClassExpiryForSpec(null, 'DeathKnight-Blood', NOW), null);
  assert.equal(activeClassExpiryForSpec(undefined, 'DeathKnight-Blood', NOW), null);
  assert.equal(activeClassExpiryForSpec({ deathknight: null }, 'DeathKnight-Blood', NOW), null);
  assert.equal(activeClassExpiryForSpec({ deathknight: {} }, 'DeathKnight-Blood', NOW), null);
});

test('timestampToDate: handles Date, ISO string, Firestore-style Timestamp, and null/garbage', () => {
  assert.deepEqual(timestampToDate(FUTURE), FUTURE);
  assert.deepEqual(timestampToDate(FUTURE.toISOString()), FUTURE);
  assert.deepEqual(timestampToDate({ toDate: () => FUTURE }), FUTURE);
  assert.equal(timestampToDate(null), null);
  assert.equal(timestampToDate('garbage'), null);
});
