/**
 * Masks a string value showing only the last 4 characters.
 * Format: ****1234
 * If value is shorter than 4 chars, mask entirely: ****
 */
export function maskSensitiveField(value: string): string {
  if (!value || value.length <= 4) return '****';
  return '****' + value.slice(-4);
}

/**
 * Masks a number, showing only last 4 digits.
 * E.g., 123456789 → ****6789
 */
export function maskNumber(value: number): string {
  return maskSensitiveField(String(value));
}
