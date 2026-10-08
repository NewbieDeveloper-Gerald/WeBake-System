/**
 * Shared zod schemas and the bilingual error formatter.
 *
 * WHAT: Reusable field validators (email, password, PH mobile, centavos) plus
 * formatZodError(), which converts zod's raw errors into our API standard:
 *
 *   { success: false, code: "VALIDATION_ERROR",
 *     message_en: "Please check the highlighted fields.",
 *     message_fil: "Pakisuri ang mga field na may mali.",
 *     errors: [{ field, message_en, message_fil }] }
 *
 * WHY: The spec requires every validation message in English AND Filipino.
 * Centralizing the dictionary here means translators edit one file, and every
 * route returns the same shape the frontend already knows how to render.
 */

'use strict';

const { z } = require('zod');

// --- Field dictionaries: one message per language, per rule ---
const MSG = {
  email: {
    invalid_en: 'Enter a valid email address.',
    invalid_fil: 'Maglagay ng wastong email address.',
  },
  password: {
    min_en: 'Password must be at least 6 characters.',
    min_fil: 'Ang password ay dapat hindi bababa sa 6 na karakter.',
    required_en: 'Password is required.',
    required_fil: 'Kailangan ang password.',
  },
  mobile: {
    // Spec: exactly 11 digits, format 09XXXXXXXXX. +63 is rejected on purpose
    // so wallet refunds always use one canonical format.
    invalid_en: 'Contact number must be 11 digits starting with 09.',
    invalid_fil: 'Ang contact number ay dapat 11 digit na nagsisimula sa 09.',
  },
  order: {
    quantity_invalid_en: 'Choose one of the allowed bundle quantities: 250, 300, 350, 400, 450, or 500.',
    quantity_invalid_fil: 'Pumili ng dami ng bundle mula sa 250, 300, 350, 400, 450, o 500.',
    min_bundles_en: 'Online orders require a minimum of 300 bundles in total.',
    min_bundles_fil: 'Ang online order ay kailangan ng hindi bababa sa 300 bundle sa kabuuan.',
    min_items_en: 'The order must contain at least one product.',
    min_items_fil: 'Ang order ay dapat may hindi bababa sa isang produkto.',
    bad_date_en: 'Delivery date must be a valid date (YYYY-MM-DD).',
    bad_date_fil: 'Ang petsa ng deliver ay dapat wastong petsa (YYYY-MM-DD).',
  },
  cart: {
    quantity_invalid_en: 'Cart bundle quantities must be 250, 300, 350, 400, 450, or 500.',
    quantity_invalid_fil: 'Ang dami ng bundle sa cart ay dapat 250, 300, 350, 400, 450, o 500.',
  },
  pos: {
    quantity_invalid_en: 'Bundle sale quantities must be 250, 300, 350, 400, 450, or 500.',
    quantity_invalid_fil: 'Ang dami ng bundle sa sale ay dapat 250, 300, 350, 400, 450, o 500.',
  },
  cancel: {
    reason_en: 'Cancellation reason must be 10 to 500 characters.',
    reason_fil: 'Ang dahilan ng pagkansela ay dapat 10 hanggang 500 karakter.',
    wallet_en: 'Wallet must be GCash or PayMaya.',
    wallet_fil: 'Ang wallet ay dapat GCash o PayMaya.',
    account_en: 'Account number must be 11 digits starting with 09.',
    account_fil: 'Ang account number ay dapat 11 digit na nagsisimula sa 09.',
    mismatch_en: 'The two account numbers do not match. Please retype carefully.',
    mismatch_fil: 'Hindi magkatugma ang dalawang account number. Pakitype ulit nang maingat.',
    name_en: 'Account holder name must be 2 to 100 characters.',
    name_fil: 'Ang pangalan ng may-ari ng account ay dapat 2 hanggang 100 karakter.',
  },
  refund: {
    note_en: 'Admin note is required (5 to 500 characters).',
    note_fil: 'Kailangan ang admin note (5 hanggang 500 karakter).',
  },
  product: {
    name_en: 'Product name must be 2 to 80 characters.',
    name_fil: 'Ang pangalan ng produkto ay dapat 2 hanggang 80 karakter.',
  },
  otp: {
    format_en: 'The verification code must be 6 digits.',
    format_fil: 'Ang verification code ay dapat 6 na digit.',
  },
  payment: {
    ref_gcash_en: 'GCash reference number must be exactly 13 digits.',
    ref_gcash_fil: 'Ang GCash reference number ay dapat eksaktong 13 digit.',
    ref_maya_en: 'PayMaya reference number must be exactly 16 digits.',
    ref_maya_fil: 'Ang PayMaya reference number ay dapat eksaktong 16 digit.',
    reason_en: 'Rejection reason is required (5 to 500 characters).',
    reason_fil: 'Kailangan ang dahilan ng pagtanggi (5 hanggang 500 karakter).',
  },
};

/** Lowercases + trims so "User@Mail.com " and "user@mail.com" match one row. */
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'email.invalid' });

const passwordField = z
  .string({ required_error: 'password.required' })
  .min(1, { message: 'password.required' })
  .min(6, { message: 'password.min' });

/** Philippine mobile: ^09 followed by exactly 9 digits. */
const mobileField = z
  .string()
  .trim()
  .regex(/^09\d{9}$/, { message: 'mobile.invalid' });

/** Money arrives as integer centavos (never float). Coerces "10500" -> 10500. */
const centavosField = z.coerce
  .number()
  .int()
  .min(0);

/**
 * Translate a zod issue code ("email.invalid") into both languages using MSG.
 * Unknown codes fall back to zod's own message in English + a generic Filipino.
 */
function translateIssue(issue) {
  // Missing field entirely (never sent): bilingual "required" instead of zod's
  // bare "Required", so every validation message stays bilingual per spec.
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return {
      message_en: 'This field is required.',
      message_fil: 'Kailangan ang field na ito.',
    };
  }
  const [group, rule] = String(issue.message || '').split('.');
  const dict = MSG[group];
  if (dict && dict[`${rule}_en`]) {
    return { message_en: dict[`${rule}_en`], message_fil: dict[`${rule}_fil`] };
  }
  return {
    message_en: issue.message || 'Invalid value.',
    message_fil: 'May maling halaga.',
  };
}

/** Convert a ZodError into the standard API error body (no stack, no internals). */
function formatZodError(zodError) {
  return {
    success: false,
    code: 'VALIDATION_ERROR',
    message_en: 'Please check the highlighted fields.',
    message_fil: 'Pakisuri ang mga field na may mali.',
    errors: zodError.issues.map((issue) => ({
      field: issue.path.join('.') || 'body',
      ...translateIssue(issue),
    })),
  };
}

/**
 * Middleware factory: validate req.body against a schema before the controller
 * runs. On success, replaces req.body with the PARSED (trimmed/coerced) data
 * so controllers always work with clean values.
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(formatZodError(result.error));
    }
    req.body = result.data;
    return next();
  };
}

/**
 * Query-string twin of validateBody, for GET endpoints like order tracking.
 * Replaces req.query with the parsed values on success.
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json(formatZodError(result.error));
    }
    req.query = result.data;
    return next();
  };
}

module.exports = {
  MSG,
  emailField,
  passwordField,
  mobileField,
  centavosField,
  formatZodError,
  validateBody,
  validateQuery,
};
