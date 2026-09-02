import { describe, expect, it } from 'vitest';

import { validateDrawRequest } from './validation.js';

describe('validateDrawRequest direct branches', () => {
  it('returns field errors for required and malformed fields', () => {
    const result = validateDrawRequest({ name: ' ', phone: '123', billNumber: ' ' });

    if (!('fieldErrors' in result)) {
      throw new Error('Expected validation errors.');
    }

    expect(result.fieldErrors.name).toBe('Name is required.');
    expect(result.fieldErrors.phone).toBe('Phone number must contain exactly 10 digits.');
    expect(result.fieldErrors.billNumber).toBe('Bill number is required.');
  });

  it('rejects unsupported name and bill characters plus control characters', () => {
    const nameControl = validateDrawRequest({
      name: 'Amit\u0007',
      phone: '9876543210',
      billNumber: 'AB123',
    });
    const nameSymbols = validateDrawRequest({
      name: 'Amit@Das',
      phone: '9876543210',
      billNumber: 'AB123',
    });
    const billControl = validateDrawRequest({
      name: 'Amit Das',
      phone: '9876543210',
      billNumber: 'AB\u0001',
    });
    const billSymbols = validateDrawRequest({
      name: 'Amit Das',
      phone: '9876543210',
      billNumber: 'AB*123',
    });

    expect('fieldErrors' in nameControl && nameControl.fieldErrors.name).toBe(
      'Name contains unsupported characters.',
    );
    expect('fieldErrors' in nameSymbols && nameSymbols.fieldErrors.name).toBe(
      'Name contains unsupported characters.',
    );
    expect('fieldErrors' in billControl && billControl.fieldErrors.billNumber).toBe(
      'Bill number contains unsupported characters.',
    );
    expect('fieldErrors' in billSymbols && billSymbols.fieldErrors.billNumber).toBe(
      'Bill number contains unsupported characters.',
    );
  });

  it('enforces max lengths for name and bill number', () => {
    const longName = 'A'.repeat(101);
    const longBill = 'B'.repeat(51);
    const result = validateDrawRequest({
      name: longName,
      phone: '9876543210',
      billNumber: longBill,
    });

    if (!('fieldErrors' in result)) {
      throw new Error('Expected validation errors.');
    }

    expect(result.fieldErrors.name).toBe('Name must be at most 100 characters.');
    expect(result.fieldErrors.billNumber).toBe('Bill number must be at most 50 characters.');
  });

  it('returns normalized success payload for valid input', () => {
    const result = validateDrawRequest({
      name: '  Amit Das  ',
      phone: '9876543210',
      billNumber: ' ab-123 ',
    });

    if ('fieldErrors' in result) {
      throw new Error('Expected valid payload.');
    }

    expect(result.name).toBe('Amit Das');
    expect(result.billNumberDisplay).toBe('ab-123');
    expect(result.billNumberNormalized).toBe('AB-123');
  });
});
