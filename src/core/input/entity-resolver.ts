export interface NamedEntity {
  id: string;
}

/** Resolve an exact id or a unique case-insensitive name. Never fuzzy-match writes. */
export function resolveEntity<T extends NamedEntity>(
  reference: string,
  entities: T[],
  nameOf: (entity: T) => string,
  label: string
): T {
  const byId = entities.find((entity) => entity.id === reference);
  if (byId) return byId;
  const normalized = reference.trim().toLocaleLowerCase();
  const matches = entities.filter((entity) => nameOf(entity).trim().toLocaleLowerCase() === normalized);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `AMBIGUOUS_${label.toUpperCase()}: ${reference} matches ${matches.map((entity) => `${nameOf(entity)} (${entity.id})`).join(', ')}`
    );
  }
  throw new Error(
    `UNKNOWN_${label.toUpperCase()}: ${reference}. Available: ${entities.map((entity) => `${nameOf(entity)} (${entity.id})`).join(', ')}`
  );
}
