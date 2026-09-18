// Raw Piraeus rAPId Link (PB API Accounts v1.2) HTTP response shapes.
// docs/13-PIRAEUS-PROVIDER.md "Assumptions": exact field names/casing
// below are BEST-EFFORT, modeled on the Berlin Group NextGenPSD2/XS2A
// shape that Piraeus's own AIS product is confirmed (via public search
// results, cited in docs/13-PIRAEUS-PROVIDER.md) to implement -- not
// verified against the live PB API Accounts v1.2 portal, which this
// environment could not reach directly (TLS certificate verification
// failure on every rapidlink.piraeusbank.gr page fetched). MUST be
// corrected against the real sandbox response during Phase 9A.2 before
// any of this is trusted with production traffic.
//
// Nothing in this file may be imported outside lib/providers/piraeus/ --
// lib/providers/piraeus/mapper.ts is the only place that reads these
// shapes; the rest of the app only ever sees lib/providers/types.ts's
// Normalized* types.

export type PiraeusTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

export type PiraeusAccountReference = {
  iban?: string;
  currency?: string;
};

// TODO(9A.2): confirm the exact envelope -- assumed `{ accounts: [...] }`
// per Berlin Group's GET /v1/accounts; PB API Accounts v1.2 may differ.
export type PiraeusAccountsResponse = {
  accounts: Array<{
    resourceId: string;
    iban?: string;
    currency: string;
    name?: string;
    product?: string;
  }>;
};

// TODO(9A.2): confirm balanceType vocabulary and envelope shape.
export type PiraeusBalancesResponse = {
  account?: PiraeusAccountReference;
  balances: Array<{
    balanceType: string;
    balanceAmount: {
      amount: string;
      currency: string;
    };
    referenceDate?: string;
    lastChangeDateTime?: string;
  }>;
};

// TODO(9A.2): confirm pagination mechanism (cursor vs page query param
// vs a `Link`-style header) and the exact transaction field names/casing.
export type PiraeusTransactionsResponse = {
  account?: PiraeusAccountReference;
  transactions: {
    booked: PiraeusTransaction[];
    pending?: PiraeusTransaction[];
  };
  // TODO(9A.2): confirm whether pagination is returned as `_links.next`
  // (Berlin Group convention) or something PB-API-specific.
  _links?: { next?: { href: string } };
};

export type PiraeusTransaction = {
  transactionId?: string;
  entryReference?: string;
  bookingDate: string;
  valueDate?: string;
  transactionAmount: {
    amount: string;
    currency: string;
  };
  creditorName?: string;
  creditorAccount?: PiraeusAccountReference;
  debtorName?: string;
  debtorAccount?: PiraeusAccountReference;
  remittanceInformationUnstructured?: string;
  // Piraeus-specific reference/code field, per rAPId Link's own naming
  // -- exact key unconfirmed (TODO 9A.2); accepted as an unknown extra
  // field until then.
  proprietaryBankTransactionCode?: string;
};

export type PiraeusTransactionDetailResponse = {
  transactionsDetails: PiraeusTransaction;
};

export type PiraeusErrorBody = {
  tppMessages?: Array<{ category?: string; code?: string; text?: string }>;
  message?: string;
};
