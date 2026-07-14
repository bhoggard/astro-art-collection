// scripts/import/normalize.ts

const ZERO_WIDTH_SPACE = /\u200B/g

export interface ParseWarning {
  field: string
  reason: string
}

export function cleanText(value: string | undefined): string | null {
  if (value === undefined) return null
  const cleaned = value
    .replace(ZERO_WIDTH_SPACE, '')
    .trim()
    .replace(/\s+/g, ' ')
  return cleaned === '' ? null : cleaned
}

export function parseLiteralBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function parseBoolean(value: string | undefined): boolean {
  return Boolean(value && value.trim() !== '')
}

export function parseDelimited(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

export function parseDateOrNull(
  value: string | undefined,
  field: string,
): { value: string | null; warning: ParseWarning | null } {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return { value: null, warning: null }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return { value: trimmed.slice(0, 10), warning: null }
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return {
      value: null,
      warning: { field, reason: `unparseable date "${trimmed}"` },
    }
  }
  return {
    value: parsed.toISOString().slice(0, 10),
    warning: {
      field,
      reason: `date "${trimmed}" did not match YYYY-MM-DD; parsed via fallback`,
    },
  }
}

export function parseTimestampOrNull(
  value: string | undefined,
  field: string,
): { value: Date | null; warning: ParseWarning | null } {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return { value: null, warning: null }
  const parsed = new Date(`${trimmed.replace(' ', 'T')}Z`)
  if (Number.isNaN(parsed.getTime())) {
    return {
      value: null,
      warning: { field, reason: `unparseable timestamp "${trimmed}"` },
    }
  }
  return { value: parsed, warning: null }
}

export function parseNumericOrNull(
  value: string | undefined,
  field: string,
): { value: string | null; warning: ParseWarning | null } {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return { value: null, warning: null }
  if (!Number.isFinite(Number(trimmed))) {
    return {
      value: null,
      warning: { field, reason: `unparseable number "${trimmed}"` },
    }
  }
  return { value: trimmed, warning: null }
}

export function parseCreationYear(value: string | undefined): {
  value: number | null
  warning: ParseWarning | null
} {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return { value: null, warning: null }
  const match = trimmed.match(/^(\d{4})/)
  if (!match) {
    return {
      value: null,
      warning: {
        field: 'Creation Date',
        reason: `unparseable creation date "${trimmed}"`,
      },
    }
  }
  return { value: Number(match[1]), warning: null }
}

export function parseBirthDate(value: string | undefined): {
  value: string | null
  warning: ParseWarning | null
} {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return { value: null, warning: null }
  if (/^\d{4}$/.test(trimmed)) {
    return {
      value: `${trimmed}-01-01`,
      warning: {
        field: 'Birth Date',
        reason: `bare year "${trimmed}" approximated to January 1`,
      },
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { value: trimmed, warning: null }
  }
  return {
    value: null,
    warning: {
      field: 'Birth Date',
      reason: `unparseable birth date "${trimmed}"`,
    },
  }
}
