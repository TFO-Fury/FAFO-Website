// Shared order-counting and payout math for the analytics endpoints.
// Kept out of the individual handlers so revenue.ts and the owner-only
// payout.ts can never drift apart on which orders count or how a payout splits.

// Same qualifying-order filter used by the revenue loops - returns the USD
// amount for an order that counts toward revenue, or null if it shouldn't.
export function countedAmount(d: any, logPrefix: string, docId: string): number | null {
  const currency = (d.currency || 'USD').toUpperCase();
  if (d.excludedFromRevenue) {
    console.log(`[${logPrefix}] Ignored excluded order ${docId}: source=${d.source || 'unknown'}, amount=${d.amount}, currency=${currency}`);
    return null;
  }
  if (d.paymentStatus !== 'completed') {
    console.log(`[${logPrefix}] Ignored incomplete order ${docId}: status=${d.paymentStatus}, amount=${d.amount}`);
    return null;
  }
  if (!d.amount) {
    console.log(`[${logPrefix}] Ignored zero-amount order ${docId}`);
    return null;
  }
  if (currency !== 'USD') {
    console.log(`[${logPrefix}] Ignored non-USD order ${docId}: amount=${d.amount}, currency=${currency}`);
    return null;
  }
  return parseFloat(d.amount) || 0;
}

const PAYPAL_FEE_PER_TRANSACTION = 2.25;
// Three-tier payout structure:
//   Tier 1 ($0-$80 net):   the entire amount funds FAFO's flat operating
//                          budget first. Owners get $0.
//   Tier 2 ($80-$400 net): the $80 budget is funded, so everything above it
//                          splits 50/50 between the two owners. No FAFO reserve.
//   Tier 3 (>$400 net):    each owner has exactly $160 at net=$400; only
//                          revenue ABOVE $400 splits 40/40/20, which is where
//                          FAFO's reserve starts accumulating.
// Payouts are AVAILABLE as soon as the $80 budget is funded (tier 2+).
const MONTHLY_OPERATING_BUDGET = 80.00;
const TIER_2_CEILING = 400.00;

const round2 = (n: number) => parseFloat(n.toFixed(2));

export function splitPayout(netAfterPayPal: number) {
  const net = Math.max(0, netAfterPayPal); // guards only the case where fees exceed revenue
  let owner1: number, owner2: number, fafoOperatingBudgetFunded: number, fafoReserve: number, unlocked: boolean;

  if (net <= MONTHLY_OPERATING_BUDGET) {
    owner1 = 0;
    owner2 = 0;
    fafoOperatingBudgetFunded = net;
    fafoReserve = 0;
    unlocked = false;
  } else if (net <= TIER_2_CEILING) {
    const amountAfterOperatingBudget = net - MONTHLY_OPERATING_BUDGET;
    owner1 = round2(amountAfterOperatingBudget / 2);
    owner2 = round2(amountAfterOperatingBudget - owner1); // owner2 absorbs the odd cent so the total is exact
    fafoOperatingBudgetFunded = MONTHLY_OPERATING_BUDGET;
    fafoReserve = 0;
    unlocked = true;
  } else {
    const excessRevenue = net - TIER_2_CEILING;
    owner1 = round2(160 + excessRevenue * 0.4);
    owner2 = round2(160 + excessRevenue * 0.4);
    fafoOperatingBudgetFunded = MONTHLY_OPERATING_BUDGET;
    fafoReserve = round2(excessRevenue * 0.2);
    unlocked = true;
  }

  return {
    payoutsUnlocked: unlocked,
    owner1Payout: owner1,
    owner2Payout: owner2,
    fafoAllocation: round2(fafoOperatingBudgetFunded),
    fafoReserve,
    amountNeededToUnlock: round2(Math.max(0, MONTHLY_OPERATING_BUDGET - net))
  };
}

// "Earned so far" runs the split on the actual period-to-date numbers; the
// projection extrapolates the period's pace (revenue and paid-transaction
// rate) across all of its days.
export function buildPayout(revenue: number, paidTransactions: number, daysElapsed: number, daysInPeriod: number) {
  const projectedGrossRevenue = (revenue / daysElapsed) * daysInPeriod;
  const projectedTransactions = Math.round((paidTransactions / daysElapsed) * daysInPeriod);
  const projectedPayPalFees = projectedTransactions * PAYPAL_FEE_PER_TRANSACTION;
  const projectedNetAfterPayPal = projectedGrossRevenue - projectedPayPalFees;

  const earnedPayPalFees = paidTransactions * PAYPAL_FEE_PER_TRANSACTION;
  const earnedNetAfterPayPal = revenue - earnedPayPalFees;

  return {
    daysElapsed,
    daysInPeriod,
    revenue: round2(revenue),
    paidTransactions,
    projectedGrossRevenue: round2(projectedGrossRevenue),
    projectedTransactions,
    projectedPayPalFees: round2(projectedPayPalFees),
    projectedNetAfterPayPal: round2(projectedNetAfterPayPal),
    ...splitPayout(projectedNetAfterPayPal),
    earned: {
      paypalFees: round2(earnedPayPalFees),
      netAfterPayPal: round2(earnedNetAfterPayPal),
      ...splitPayout(earnedNetAfterPayPal)
    }
  };
}
