export const WOW_CLASSES = [
  'death knight', 'demon hunter', 'druid', 'evoker', 'hunter',
  'mage', 'monk', 'paladin', 'priest', 'rogue', 'shaman',
  'warlock', 'warrior'
];

// Single source of truth for plan pricing. Never trust a client-supplied amount.
export const PRICES = {
  trial: 0,
  single: 35,
  aio: 35 // marked down from 50
} as const;

export type PlanType = keyof typeof PRICES;

export function isValidPlan(plan: any): plan is PlanType {
  return plan === 'trial' || plan === 'single' || plan === 'aio';
}

export function isValidClassName(className: any): boolean {
  return typeof className === 'string' && WOW_CLASSES.includes(className.toLowerCase());
}

/**
 * Computes the amount a user should actually be charged for a plan, given their
 * current entitlements. Mirrors the client's proration display but is the
 * authoritative source used to create/validate PayPal orders server-side.
 */
export function computeExpectedAmount(plan: PlanType, currentPlan: string): number {
  if (plan === 'aio' && currentPlan === 'single') {
    // AIO now costs the same as Single, so upgrading is free.
    return 0;
  }
  return PRICES[plan];
}
