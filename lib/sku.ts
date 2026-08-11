/**
 * Normalizes an optional seller SKU before it is persisted.
 *
 * Whitespace-only values are stored as null so the seller-scoped unique
 * constraint only applies to meaningful SKU values.
 */
export function normalizeSku(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();

  return normalized || null;
}
