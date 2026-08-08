/**
 * The one hash behind every per-agent visual: identity colour and portrait both derive from
 * it, so a given slug always resolves to the same pair everywhere in the product.
 *
 * Lives in its own module because both `role-tag` and `agent-portrait` need it, and having
 * either own it makes the two import each other.
 */
const IDENTITY_TOKENS = ["--ident-1", "--ident-2", "--ident-3", "--ident-4", "--ident-5", "--ident-6"] as const;

export function identityHash(key: string): number {
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  }
  return Math.abs(hash);
}

export function identityToken(key: string): (typeof IDENTITY_TOKENS)[number] {
  return IDENTITY_TOKENS[identityHash(key) % IDENTITY_TOKENS.length]!;
}

/**
 * Deliberately a different algorithm (djb2, not the multiply-by-31 above) rather than the
 * same hash with a different modulus. The palette has 6 entries and the portrait pool has
 * 36; since 36 is a multiple of 6, `hash % 36` would fully determine `hash % 6`, welding
 * each face to one colour forever and collapsing 6 x 36 combinations down to 36.
 */
export function portraitHash(key: string): number {
  let hash = 5381;
  for (const char of key) {
    hash = ((hash * 33) ^ (char.codePointAt(0) ?? 0)) | 0;
  }
  return Math.abs(hash);
}
