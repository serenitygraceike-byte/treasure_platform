import { mapFormanceError, mapNetworkError } from "./errors";
import type { Posting } from "./postings";

// docs/02-LEDGER-SPEC.md "Ledger adapter": the rest of the application
// talks to lib/ledger/service.ts, never to these HTTP calls directly.
function config() {
  const baseUrl = process.env.FORMANCE_BASE_URL;
  const ledger = process.env.FORMANCE_STACK;
  if (!baseUrl || !ledger) {
    throw new Error("FORMANCE_BASE_URL and FORMANCE_STACK must be set.");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), ledger, token: process.env.FORMANCE_API_TOKEN };
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const { baseUrl, token } = config();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  try {
    return await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch (cause) {
    throw mapNetworkError(cause);
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await rawRequest(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw mapFormanceError(response.status, body);
  }
  return (await response.json()) as T;
}

export async function ensureLedgerExists(): Promise<void> {
  const { ledger } = config();
  const existing = await rawRequest(`/v2/${ledger}`, { method: "GET" });
  if (existing.ok) {
    return;
  }
  if (existing.status !== 404) {
    const body = await existing.json().catch(() => undefined);
    throw mapFormanceError(existing.status, body);
  }
  const created = await rawRequest(`/v2/${ledger}`, { method: "POST", body: JSON.stringify({}) });
  if (!created.ok) {
    const body = await created.json().catch(() => undefined);
    throw mapFormanceError(created.status, body);
  }
}

export type FormanceTransaction = {
  id: number;
  timestamp: string;
  postings: { amount: number; asset: string; source: string; destination: string }[];
  reference?: string;
  metadata?: Record<string, string>;
};

export async function createTransaction(
  postings: Posting[],
  options: { idempotencyKey: string; reference?: string; metadata?: Record<string, string> }
): Promise<FormanceTransaction> {
  const { ledger } = config();
  const response = await requestJson<{ data: FormanceTransaction }>(`/v2/${ledger}/transactions`, {
    method: "POST",
    headers: { "Idempotency-Key": options.idempotencyKey },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      postings: postings.map((posting) => ({
        amount: Number(posting.amount),
        asset: posting.asset,
        source: posting.source,
        destination: posting.destination,
      })),
      reference: options.reference,
      metadata: options.metadata,
    }),
  });
  return response.data;
}

export type FormanceAccount = {
  address: string;
  metadata: Record<string, string>;
  volumes?: Record<string, { input: number; output: number; balance: number }>;
};

// `expand=volumes` is required — verified live against v2.4.12: without it,
// GET /accounts/{address} omits `volumes` entirely (contrary to the
// unqualified example in Formance's own published docs).
export async function getAccount(address: string): Promise<FormanceAccount> {
  const { ledger } = config();
  const response = await requestJson<{ data: FormanceAccount }>(
    `/v2/${ledger}/accounts/${encodeURIComponent(address)}?expand=volumes`,
    { method: "GET" }
  );
  return response.data;
}

export async function addAccountMetadata(
  address: string,
  metadata: Record<string, string>
): Promise<void> {
  const { ledger } = config();
  const response = await rawRequest(`/v2/${ledger}/accounts/${encodeURIComponent(address)}/metadata`, {
    method: "POST",
    body: JSON.stringify(metadata),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw mapFormanceError(response.status, body);
  }
}
