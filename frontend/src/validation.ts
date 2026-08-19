import type { DrawRequest } from './types';

export type FormField = 'name' | 'phone' | 'billNumber';
export type FormErrors = Partial<Record<FormField, string>>;

const MAX_NAME_LENGTH = 100;
const MAX_BILL_LENGTH = 50;
const NAME_ALLOWED_REGEX = /^[\p{L} .'-]+$/u;
const BILL_ALLOWED_REGEX = /^[A-Za-z0-9./-]+$/;

const hasControlCharacters = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
};

export const validateForm = (value: DrawRequest): FormErrors => {
  const errors: FormErrors = {};

  const normalizedName = value.name.trim();
  if (normalizedName.length === 0) {
    errors.name = 'Name is required.';
  } else if (normalizedName.length > MAX_NAME_LENGTH) {
    errors.name = 'Name must be at most 100 characters.';
  } else if (hasControlCharacters(normalizedName) || !NAME_ALLOWED_REGEX.test(normalizedName)) {
    errors.name = 'Name contains unsupported characters.';
  }

  if (!/^\d{10}$/.test(value.phone)) {
    errors.phone = 'Phone number must contain exactly 10 digits.';
  }

  const trimmedBill = value.billNumber.trim();
  if (trimmedBill.length === 0) {
    errors.billNumber = 'Bill number is required.';
  } else if (trimmedBill.length > MAX_BILL_LENGTH) {
    errors.billNumber = 'Bill number must be at most 50 characters.';
  } else if (hasControlCharacters(trimmedBill) || !BILL_ALLOWED_REGEX.test(trimmedBill)) {
    errors.billNumber = 'Bill number contains unsupported characters.';
  }

  return errors;
};
