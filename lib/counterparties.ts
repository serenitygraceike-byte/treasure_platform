import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { encryptPayoutDetails } from "@/lib/crypto/encryption";
import type { Beneficiary, CounterpartyType, PaymentMethod } from "../generated/prisma/client";

type Context = { actorUserId: string; correlationId?: string };

export class CounterpartyValidationError extends Error {}

export async function createCounterparty(
  organizationId: string,
  input: {
    legalName: string;
    type: CounterpartyType;
    countryCode?: string;
    registrationNumber?: string;
    taxIdentifier?: string;
    externalReference?: string;
  },
  ctx: Context
) {
  const counterparty = await prisma.counterparty.create({
    data: { organizationId, ...input },
  });

  await logAudit({
    organizationId,
    actorUserId: ctx.actorUserId,
    action: "counterparty.create",
    objectType: "counterparty",
    objectId: counterparty.id,
    correlationId: ctx.correlationId,
  });

  return counterparty;
}

export async function listCounterparties(organizationId: string) {
  return prisma.counterparty.findMany({
    where: { organizationId },
    orderBy: { legalName: "asc" },
  });
}

// payoutDetails arrives as plaintext (an IBAN, a wallet address, ...) and
// is encrypted before it ever reaches the database -- see
// lib/crypto/encryption.ts and docs/01-DATABASE-SPEC.md's column name.
// Never returned in plaintext by any read path.
export async function createBeneficiary(
  counterparty: { id: string; organizationId: string },
  input: { paymentMethod: PaymentMethod; payoutDetails: string },
  ctx: Context
) {
  const beneficiary = await prisma.beneficiary.create({
    data: {
      counterpartyId: counterparty.id,
      paymentMethod: input.paymentMethod,
      payoutDetailsEncrypted: encryptPayoutDetails(input.payoutDetails),
    },
  });

  await logAudit({
    organizationId: counterparty.organizationId,
    actorUserId: ctx.actorUserId,
    action: "beneficiary.create",
    objectType: "beneficiary",
    objectId: beneficiary.id,
    correlationId: ctx.correlationId,
    metadata: { paymentMethod: input.paymentMethod },
  });

  // Never return payoutDetailsEncrypted -- callers only need to know the
  // beneficiary now exists, not its ciphertext.
  return omitPayoutDetails(beneficiary);
}

export async function listBeneficiaries(counterpartyId: string) {
  const rows = await prisma.beneficiary.findMany({
    where: { counterpartyId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(omitPayoutDetails);
}

function omitPayoutDetails(row: Beneficiary) {
  return {
    id: row.id,
    counterpartyId: row.counterpartyId,
    paymentMethod: row.paymentMethod,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
