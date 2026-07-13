// tests/import/normalize.test.ts
import { describe, expect, it } from 'vitest';
import {
  cleanText,
  parseBirthDate,
  parseBoolean,
  parseCreationYear,
  parseDateOrNull,
  parseDelimited,
  parseLiteralBoolean,
  parseNumericOrNull,
  parseTimestampOrNull,
} from '../../scripts/import/normalize';

describe('cleanText', () => {
  it('trims whitespace and returns null for empty strings', () => {
    expect(cleanText('  hello  ')).toBe('hello');
    expect(cleanText('')).toBeNull();
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });

  it('strips zero-width spaces and collapses internal whitespace', () => {
    expect(cleanText('hello​​world')).toBe('helloworld');
    expect(cleanText('too    many   spaces')).toBe('too many spaces');
  });
});

describe('parseLiteralBoolean', () => {
  it('matches the Contacts CSV literal true/false convention', () => {
    expect(parseLiteralBoolean('true')).toBe(true);
    expect(parseLiteralBoolean('false')).toBe(false);
    expect(parseLiteralBoolean('')).toBe(false);
    expect(parseLiteralBoolean(undefined)).toBe(false);
  });
});

describe('parseBoolean', () => {
  it('matches the Pieces CSV blank=false/any-value=true convention', () => {
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('')).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
  });
});

describe('parseDelimited', () => {
  it('splits on comma, trims, and drops empty pieces', () => {
    expect(parseDelimited('Male Artists, Female Artists')).toEqual(['Male Artists', 'Female Artists']);
    expect(parseDelimited('Single Value')).toEqual(['Single Value']);
    expect(parseDelimited('')).toEqual([]);
    expect(parseDelimited(undefined)).toEqual([]);
  });
});

describe('parseDateOrNull', () => {
  it('passes through a full ISO date unchanged with no warning', () => {
    expect(parseDateOrNull('2025-07-27', 'Date Added')).toEqual({ value: '2025-07-27', warning: null });
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseDateOrNull('', 'Date Added')).toEqual({ value: null, warning: null });
    expect(parseDateOrNull(undefined, 'Date Added')).toEqual({ value: null, warning: null });
  });

  it('flags an unparseable date', () => {
    const result = parseDateOrNull('not a date', 'Date Added');
    expect(result.value).toBeNull();
    expect(result.warning).toEqual({ field: 'Date Added', reason: 'unparseable date "not a date"' });
  });
});

describe('parseTimestampOrNull', () => {
  it('parses a "YYYY-MM-DD HH:MM:SS" timestamp', () => {
    const result = parseTimestampOrNull('2024-11-13 10:20:32', 'Last Updated');
    expect(result.warning).toBeNull();
    expect(result.value?.toISOString().slice(0, 19)).toBe('2024-11-13T10:20:32');
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseTimestampOrNull('', 'Last Updated')).toEqual({ value: null, warning: null });
  });
});

describe('parseNumericOrNull', () => {
  it('passes through a valid number as a string', () => {
    expect(parseNumericOrNull('2500.0', 'Purchase Price')).toEqual({ value: '2500.0', warning: null });
  });

  it('flags an unparseable number', () => {
    const result = parseNumericOrNull('abc', 'Purchase Price');
    expect(result.value).toBeNull();
    expect(result.warning).toEqual({ field: 'Purchase Price', reason: 'unparseable number "abc"' });
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseNumericOrNull('', 'Purchase Price')).toEqual({ value: null, warning: null });
  });
});

describe('parseCreationYear', () => {
  it('extracts a bare 4-digit year', () => {
    expect(parseCreationYear('2003')).toEqual({ value: 2003, warning: null });
  });

  it('extracts the leading year from a year-month value', () => {
    expect(parseCreationYear('2017-06')).toEqual({ value: 2017, warning: null });
  });

  it('flags a value with no leading year', () => {
    const result = parseCreationYear('circa');
    expect(result.value).toBeNull();
    expect(result.warning).toEqual({ field: 'Creation Date', reason: 'unparseable creation date "circa"' });
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseCreationYear('')).toEqual({ value: null, warning: null });
  });
});

describe('parseBirthDate', () => {
  it('approximates a bare year to January 1st, with a warning', () => {
    const result = parseBirthDate('1974');
    expect(result.value).toBe('1974-01-01');
    expect(result.warning).toEqual({ field: 'Birth Date', reason: 'bare year "1974" approximated to January 1' });
  });

  it('passes through a full ISO date unchanged with no warning', () => {
    expect(parseBirthDate('1976-05-02')).toEqual({ value: '1976-05-02', warning: null });
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseBirthDate('')).toEqual({ value: null, warning: null });
  });

  it('flags an unparseable birth date', () => {
    const result = parseBirthDate('sometime in the 70s');
    expect(result.value).toBeNull();
    expect(result.warning).toEqual({ field: 'Birth Date', reason: 'unparseable birth date "sometime in the 70s"' });
  });
});
