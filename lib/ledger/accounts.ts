// docs/02-LEDGER-SPEC.md proposes addresses like
// "org:1:company:gr-a:bank:mercury-eur:EUR" but Formance account addresses
// must match ^\w+(:\w+)*$ (word chars only between colons) — UUIDs contain
// hyphens, so every id segment is sanitized before being joined. This is
// the "exact syntax must be normalized before implementation" step the
// spec doc calls for.
export function sanitizeSegment(id: string): string {
  const sanitized = id.replace(/[^A-Za-z0-9_]/g, "");
  if (sanitized.length === 0) {
    throw new Error(`Segment "${id}" has no valid address characters after sanitization.`);
  }
  return sanitized;
}

function buildAddress(segments: string[]): string {
  return segments.map(sanitizeSegment).join(":");
}

export function bankAddress(
  organizationId: string,
  companyId: string,
  bankAccountId: string,
  asset: string
): string {
  return buildAddress(["org", organizationId, "company", companyId, "bank", bankAccountId, asset]);
}

export function reservedAddress(organizationId: string, companyId: string, asset: string): string {
  return buildAddress(["org", organizationId, "company", companyId, "reserved", asset]);
}

export function inTransitAddress(organizationId: string, companyId: string, asset: string): string {
  return buildAddress(["org", organizationId, "company", companyId, "in_transit", asset]);
}

export function expenseAddress(
  organizationId: string,
  companyId: string,
  category: string,
  asset: string
): string {
  return buildAddress(["org", organizationId, "company", companyId, "expense", category, asset]);
}

export function payableAddress(organizationId: string, companyId: string, asset: string): string {
  return buildAddress(["org", organizationId, "company", companyId, "payable", asset]);
}

export function counterpartyAddress(
  organizationId: string,
  counterpartyId: string,
  asset: string
): string {
  return buildAddress(["org", organizationId, "counterparty", counterpartyId, asset]);
}
