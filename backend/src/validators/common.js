/**
 * Shared zod schemas and error formatter.
 *
 * WHAT: Reusable field validators (email, password, PH mobile, centavos) plus
 * formatZodError(), which converts zod's raw errors into our API standard:
 *
 *   { success: false, code: "VALIDATION_ERROR",
 *     message: "Please check the highlighted fields.",
 *     message_en: "Please check the highlighted fields.",
 *     errors: [{ field, message, message_en }] }
 */

'use strict';

const { z } = require('zod');

// --- Field dictionaries: English messages per rule ---
const MSG = {
  email: {
    invalid_en: 'Enter a valid email address.',
  },
  password: {
    min_en: 'Password must be at least 6 characters.',
    required_en: 'Password is required.',
  },
  mobile: {
    invalid_en: 'Contact number must be 11 digits starting with 09.',
  },
  order: {
    quantity_invalid_en: 'Choose one of the allowed bundle quantities: 300, 350, 400, 450, or 500.',
    min_bundles_en: 'Online orders require a minimum of 300 bundles in total.',
    min_items_en: 'The order must contain at least one product.',
    bad_date_en: 'Delivery date must be a valid date (YYYY-MM-DD).',
  },
  cart: {
    quantity_invalid_en: 'Cart bundle quantities must be 300, 350, 400, 450, or 500.',
  },
  pos: {
    quantity_invalid_en: 'Bundle sale quantities must be 300, 350, 400, 450, or 500.',
  },
  cancel: {
    reason_en: 'Cancellation reason must be 10 to 500 characters.',
    wallet_en: 'Wallet must be GCash or PayMaya.',
    account_en: 'Account number must be 11 digits starting with 09.',
    mismatch_en: 'The two account numbers do not match. Please retype carefully.',
    name_en: 'Account holder name must be 2 to 100 characters.',
  },
  refund: {
    note_en: 'Admin note is required (5 to 500 characters).',
  },
  product: {
    name_en: 'Product name must be 2 to 80 characters.',
  },
  otp: {
    format_en: 'The verification code must be 6 digits.',
  },
  payment: {
    ref_gcash_en: 'GCash reference number must be exactly 13 digits.',
    ref_maya_en: 'PayMaya reference number must be exactly 16 digits.',
    reason_en: 'Rejection reason is required (5 to 500 characters).',
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
 * Translate a zod issue code ("email.invalid") into English using MSG.
 */
function translateIssue(issue) {
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return {
      message: 'This field is required.',
      message_en: 'This field is required.',
    };
  }
  const [group, rule] = String(issue.message || '').split('.');
  const dict = MSG[group];
  if (dict && dict[`${rule}_en`]) {
    const msg = dict[`${rule}_en`];
    return { message: msg, message_en: msg };
  }
  const fallback = issue.message || 'Invalid value.';
  return {
    message: fallback,
    message_en: fallback,
  };
}

/** Convert a ZodError into the standard API error body. */
function formatZodError(zodError) {
  return {
    success: false,
    code: 'VALIDATION_ERROR',
    message: 'Please check the highlighted fields.',
    message_en: 'Please check the highlighted fields.',
    errors: zodError.issues.map((issue) => ({
      field: issue.path.join('.') || 'body',
      ...translateIssue(issue),
    })),
  };
}

/**
 * Middleware factory: validate req.body against a schema before the controller runs.
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
