/**
 * Money helpers: the system stores INTEGER centavos, never floats.
 *
 * WHAT: downpayment math (round UP per confirmed Q2), balance math, and a
 * display formatter for emails/receipts.
 *
 * WHY integers: 0.1 + 0.2 === 0.30000000000000004 in binary floating point.
 * One drifting centavo in a downpayment breaks "balance = total - downpayment"
 * trust. Integer math is exact forever; division by 100 happens only for
 * human display, at the last possible moment.
 */

'use strict';

const CENTAVOS_PER_PESO = 100;

/**
 * 50% downpayment rounded UP to the whole peso, in centavos.
 * Example: total 31525c (PHP 315.25) -> ceil(31525/2) = 15763c (PHP 157.63).
 * Pure integer math: (n+1)//2 equals ceil(n/2) for positive integers.
 */
function downpaymentFor(totalCentavos) {
  assertCentavos(totalCentavos);
  return Math.floor((totalCentavos + 1) / 2);
}

/** Remaining balance. Always total - downpayment (confirmed Q2). */
function balanceFor(totalCentavos, downpaymentCentavos) {
  assertCentavos(totalCentavos);
  assertCentavos(downpaymentCentavos);
  return totalCentavos - downpaymentCentavos;
}

/** "15763" -> "PHP 157.63". Display only; never parse this back into math. */
function formatPesos(centavos) {
  assertCentavos(centavos);
  const pesos = (centavos / CENTAVOS_PER_PESO).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `PHP ${pesos}`;
}

function assertCentavos(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Money must be a non-negative integer of centavos, got: ${value}`);
  }
}

module.exports = { CENTAVOS_PER_PESO, downpaymentFor, balanceFor, formatPesos };
