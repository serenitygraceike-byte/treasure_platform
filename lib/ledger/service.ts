import * as client from "./client";
import {
  bankAddress,
  inTransitAddress,
  reservedAddress,
} from "./accounts";
import { toMinorUnits, fromMinorUnits } from "./money";
import {
  releaseReservationPosting,
  reserveFundsPosting,
  settleTransferPosting,
  startTransferPosting,
  type Posting,
} from "./postings";
import { requireCorrelationId, requireIdempotencyKey } from "./idempotency";
import type { FormanceTransaction } from "./client";

// docs/02-LEDGER-SPEC.md: "the rest of the application talks to
// LedgerService, not directly to Formance HTTP endpoints." Plain exported
// functions, matching lib/rbac.ts / lib/audit.ts style rather than a class.

export async function ensureLedgerReady(): Promise<void> {
  await client.ensureLedgerExists();
}

type MoneyOpContext = {
  idempotencyKey: string;
  correlationId: string;
};

async function postSingle(
  posting: Posting,
  context: MoneyOpContext
): Promise<FormanceTransaction> {
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const correlationId = requireCorrelationId(context.correlationId);
  return client.createTransaction([posting], {
    idempotencyKey,
    metadata: { correlationId },
  });
}

// Generic primitive — used by the named operations below and by tests to
// seed test bank balances from Formance's built-in `world` account (there
// is no real funding source yet; that arrives with bank accounts/providers
// in later phases).
export async function postTransaction(
  postings: Posting[],
  context: MoneyOpContext & { reference?: string }
): Promise<FormanceTransaction> {
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const correlationId = requireCorrelationId(context.correlationId);
  return client.createTransaction(postings, {
    idempotencyKey,
    reference: context.reference,
    metadata: { correlationId },
  });
}

export async function reserveFunds(
  input: { organizationId: string; companyId: string; bankAccountId: string; asset: string; amount: string } & MoneyOpContext
): Promise<FormanceTransaction> {
  const bank = bankAddress(input.organizationId, input.companyId, input.bankAccountId, input.asset);
  const reserved = reservedAddress(input.organizationId, input.companyId, input.asset);
  const amount = toMinorUnits(input.amount, input.asset);
  return postSingle(reserveFundsPosting(bank, reserved, amount, input.asset), input);
}

export async function releaseReservation(
  input: { organizationId: string; companyId: string; bankAccountId: string; asset: string; amount: string } & MoneyOpContext
): Promise<FormanceTransaction> {
  const bank = bankAddress(input.organizationId, input.companyId, input.bankAccountId, input.asset);
  const reserved = reservedAddress(input.organizationId, input.companyId, input.asset);
  const amount = toMinorUnits(input.amount, input.asset);
  return postSingle(releaseReservationPosting(reserved, bank, amount, input.asset), input);
}

export async function startTransfer(
  input: { organizationId: string; companyId: string; bankAccountId: string; asset: string; amount: string } & MoneyOpContext
): Promise<FormanceTransaction> {
  const bank = bankAddress(input.organizationId, input.companyId, input.bankAccountId, input.asset);
  const inTransit = inTransitAddress(input.organizationId, input.companyId, input.asset);
  const amount = toMinorUnits(input.amount, input.asset);
  return postSingle(startTransferPosting(bank, inTransit, amount, input.asset), input);
}

export async function settleTransfer(
  input: {
    organizationId: string;
    companyId: string;
    destinationAddress: string;
    asset: string;
    amount: string;
  } & MoneyOpContext
): Promise<FormanceTransaction> {
  const inTransit = inTransitAddress(input.organizationId, input.companyId, input.asset);
  const amount = toMinorUnits(input.amount, input.asset);
  return postSingle(
    settleTransferPosting(inTransit, input.destinationAddress, amount, input.asset),
    input
  );
}

export async function getAccountBalance(
  address: string,
  asset: string
): Promise<{ address: string; asset: string; balance: string }> {
  const account = await client.getAccount(address);
  const volume = account.volumes?.[asset];
  const balanceMinorUnits = BigInt(volume?.balance ?? 0);
  return { address, asset, balance: fromMinorUnits(balanceMinorUnits, asset) };
}
