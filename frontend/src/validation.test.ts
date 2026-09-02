import { describe, expect, it } from 'vitest';

import { validateForm } from './validation';

describe('frontend validation', () => {
  it('accepts a valid form payload', () => {
    const result = validateForm({
      name: 'Arindam Roy',
      phone: '9876543210',
      billNumber: 'DB-12345/1',
    });

    expect(result).toEqual({});
  });

  it('rejects whitespace-only name', () => {
    const result = validateForm({
      name: '   ',
      phone: '9876543210',
      billNumber: 'DB12345',
    });

    expect(result.name).toBe('Name is required.');
  });

  it('rejects overly long name', () => {
    const result = validateForm({
      name: 'A'.repeat(101),
      phone: '9876543210',
      billNumber: 'DB12345',
    });

    expect(result.name).toBe('Name must be at most 100 characters.');
  });

  it('rejects unsupported name characters', () => {
    const result = validateForm({
      name: 'Arindam123',
      phone: '9876543210',
      billNumber: 'DB12345',
    });

    expect(result.name).toBe('Name contains unsupported characters.');
  });

  it('rejects control characters in text fields', () => {
    const result = validateForm({
      name: 'Arindam\u007fRoy',
      phone: '9876543210',
      billNumber: 'DB\u000012345',
    });

    expect(result.name).toBe('Name contains unsupported characters.');
    expect(result.billNumber).toBe('Bill number contains unsupported characters.');
  });

  it('rejects non-10-digit phone number', () => {
    const result = validateForm({
      name: 'Arindam Roy',
      phone: '12345',
      billNumber: 'DB12345',
    });

    expect(result.phone).toBe('Phone number must contain exactly 10 digits.');
  });

  it('rejects empty bill', () => {
    const result = validateForm({
      name: 'Arindam Roy',
      phone: '9876543210',
      billNumber: ' ',
    });

    expect(result.billNumber).toBe('Bill number is required.');
  });

  it('rejects unsupported bill characters', () => {
    const result = validateForm({
      name: 'Arindam Roy',
      phone: '9876543210',
      billNumber: 'DB12345*',
    });

    expect(result.billNumber).toBe('Bill number contains unsupported characters.');
  });

  it('rejects bill longer than 50 characters', () => {
    const result = validateForm({
      name: 'Arindam Roy',
      phone: '9876543210',
      billNumber: 'A'.repeat(51),
    });

    expect(result.billNumber).toBe('Bill number must be at most 50 characters.');
  });
});
