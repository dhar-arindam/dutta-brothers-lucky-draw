import type { DrawRequest } from './contracts.js';
import { normalizeBillNumber, trimName } from './normalization.js';

const MAX_NAME_LENGTH = 100;
const MAX_BILL_LENGTH = 50;
const hasControlCharacters = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
};
const NAME_ALLOWED_REGEX = /^[\p{L} .'-]+$/u;
const BILL_ALLOWED_REGEX = /^[A-Za-z0-9./-]+$/;
const PHONE_REGEX = /^\d{10}$/;

export interface ValidatedDrawInput {
  name: string;
  phone: string;
  billNumberDisplay: string;
  billNumberNormalized: string;
}

export interface ValidationErrorShape {
  message: string;
  fieldErrors: Partial<Record<'name' | 'phone' | 'billNumber', string>>;
}

export const validateDrawRequest = (
  request: DrawRequest,
): ValidationErrorShape | ValidatedDrawInput => {
  const fieldErrors: ValidationErrorShape['fieldErrors'] = {};

  const normalizedName = trimName(request.name);
  if (normalizedName.length === 0) {
    fieldErrors.name = 'Name is required.';
  } else if (normalizedName.length > MAX_NAME_LENGTH) {
    fieldErrors.name = 'Name must be at most 100 characters.';
  } else if (hasControlCharacters(normalizedName)) {
    fieldErrors.name = 'Name contains unsupported characters.';
  } else if (!NAME_ALLOWED_REGEX.test(normalizedName)) {
    fieldErrors.name = 'Name contains unsupported characters.';
  }

  if (!PHONE_REGEX.test(request.phone)) {
    fieldErrors.phone = 'Phone number must contain exactly 10 digits.';
  }

  const billTrimmed = request.billNumber.trim();
  if (billTrimmed.length === 0) {
    fieldErrors.billNumber = 'Bill number is required.';
  } else if (billTrimmed.length > MAX_BILL_LENGTH) {
    fieldErrors.billNumber = 'Bill number must be at most 50 characters.';
  } else if (hasControlCharacters(billTrimmed)) {
    fieldErrors.billNumber = 'Bill number contains unsupported characters.';
  } else if (!BILL_ALLOWED_REGEX.test(billTrimmed)) {
    fieldErrors.billNumber = 'Bill number contains unsupported characters.';
  }

  const billNormalized = normalizeBillNumber(request.billNumber);
  if (billNormalized.length > MAX_BILL_LENGTH) {
    fieldErrors.billNumber = 'Bill number must be at most 50 characters.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      message: 'Please check the form and try again.',
      fieldErrors,
    };
  }

  return {
    name: normalizedName,
    phone: request.phone,
    billNumberDisplay: billTrimmed,
    billNumberNormalized: billNormalized,
  };
};
