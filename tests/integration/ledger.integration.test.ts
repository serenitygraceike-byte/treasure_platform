// Requires a live local Formance ledger:
//   docker compose -f infrastructure/docker/docker-compose.dev.yml up -d formance-postgres formance-ledger
//   pnpm test:integration
// Not part of `pnpm test` / CI (see vitest.config.ts) — matches the
// ci.yml comment that live-Formance integration tests land in a later
// phase's pipeline, not this one.
import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bankAddress, inTransitAddress, reservedAddress } from "@/lib/ledger/accounts";
import { toMinorUnits } from "@/lib/ledger/money";
import {
  ensureLedgerReady,
  getAccountBalance,
  postTransaction,
  releaseReservation,
  reserveFunds,
  settleTransfer,
  startTransfer,
} from "@/lib/ledger/service";

process.env.FORMANCE_BASE_URL ??= "http://localhost:3068";
process.env.FORMANCE_STACK ??= "treasury-dev";

const ASSET = "EUR";

async function fundBankAccount(bank: string, amount: string, correlationId: string) {
  await postTransaction(
    [{ source: "world", destination: bank, amount: toMinorUnits(amount, ASSET), asset: ASSET }],
    { idempotencyKey: crypto.randomUUID(), correlationId }
  );
}

describe("ledger integration (Formance)", () => {
  beforeAll(async () => {
    await ensureLedgerReady();
  }, 30_000);

  it("bank -> in_transit -> destination (start + settle transfer)", async () => {
    const organizationId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const bankAccountId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const bank = bankAddress(organizationId, companyId, bankAccountId, ASSET);
    const inTransit = inTransitAddress(organizationId, companyId, ASSET);
    const destination = bankAddress(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      ASSET
    );

    await fundBankAccount(bank, "100.00", correlationId);

    await startTransfer({
      organizationId,
      companyId,
      bankAccountId,
      asset: ASSET,
      amount: "40.00",
      idempotencyKey: crypto.randomUUID(),
      correlationId,
    });

    const afterStart = await getAccountBalance(inTransit, ASSET);
    expect(afterStart.balance).toBe("40.00");

    await settleTransfer({
      organizationId,
      companyId,
      destinationAddress: destination,
      asset: ASSET,
      amount: "40.00",
      idempotencyKey: crypto.randomUUID(),
      correlationId,
    });

    const afterSettle = await getAccountBalance(inTransit, ASSET);
    expect(afterSettle.balance).toBe("0.00");

    const destinationBalance = await getAccountBalance(destination, ASSET);
    expect(destinationBalance.balance).toBe("40.00");
  }, 30_000);

  it("reservation / release round-trips the bank balance", async () => {
    const organizationId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const bankAccountId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const bank = bankAddress(organizationId, companyId, bankAccountId, ASSET);
    const reserved = reservedAddress(organizationId, companyId, ASSET);

    await fundBankAccount(bank, "100.00", correlationId);

    await reserveFunds({
      organizationId,
      companyId,
      bankAccountId,
      asset: ASSET,
      amount: "25.00",
      idempotencyKey: crypto.randomUUID(),
      correlationId,
    });

    expect((await getAccountBalance(reserved, ASSET)).balance).toBe("25.00");
    expect((await getAccountBalance(bank, ASSET)).balance).toBe("75.00");

    await releaseReservation({
      organizationId,
      companyId,
      bankAccountId,
      asset: ASSET,
      amount: "25.00",
      idempotencyKey: crypto.randomUUID(),
      correlationId,
    });

    expect((await getAccountBalance(reserved, ASSET)).balance).toBe("0.00");
    expect((await getAccountBalance(bank, ASSET)).balance).toBe("100.00");
  }, 30_000);

  it("repeats the same idempotency key safely (no double posting)", async () => {
    const organizationId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const bankAccountId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const bank = bankAddress(organizationId, companyId, bankAccountId, ASSET);
    const reserved = reservedAddress(organizationId, companyId, ASSET);
    const idempotencyKey = crypto.randomUUID();

    await fundBankAccount(bank, "100.00", correlationId);

    const first = await reserveFunds({
      organizationId,
      companyId,
      bankAccountId,
      asset: ASSET,
      amount: "10.00",
      idempotencyKey,
      correlationId,
    });

    const second = await reserveFunds({
      organizationId,
      companyId,
      bankAccountId,
      asset: ASSET,
      amount: "10.00",
      idempotencyKey,
      correlationId,
    });

    expect(second.id).toBe(first.id);
    expect((await getAccountBalance(reserved, ASSET)).balance).toBe("10.00");
  }, 30_000);
});
