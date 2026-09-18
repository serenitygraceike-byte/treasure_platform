import { prisma } from "@/lib/prisma";
import type { PaymentMethod, Provider, ProviderType } from "../../generated/prisma/client";
import { mockBankProvider } from "./mock-bank";
import { mockCryptoProvider } from "./mock-crypto";
import { mockPayoutProvider } from "./mock-payout";
import type { CreateTransferInput, ProviderEvent, ProviderPayment } from "./types";

// providers.organization_id is NOT NULL (docs/01-DATABASE-SPEC.md) -- one
// row per (organization, type), auto-provisioned on first use rather
// than a manual "configure a provider" flow (see schema.prisma's Phase 6
// header comment for why).
export async function getOrCreateProvider(
  organizationId: string,
  type: ProviderType
): Promise<Provider> {
  return prisma.provider.upsert({
    where: { organizationId_type: { organizationId, type } },
    update: {},
    create: { organizationId, type, name: type },
  });
}

const PROVIDER_TYPE_BY_PAYMENT_METHOD: Partial<Record<PaymentMethod, ProviderType>> = {
  BANK_TRANSFER: "MOCK_BANK",
  CRYPTO_EXCHANGE: "MOCK_CRYPTO",
  CARD_PAYOUT: "MOCK_PAYOUT",
};

// MANUAL has no entry -- lib/payments/payments.ts skips the provider
// call entirely for that method (see its executePayment).
export function providerTypeForPaymentMethod(method: PaymentMethod): ProviderType | undefined {
  return PROVIDER_TYPE_BY_PAYMENT_METHOD[method];
}

// Facade so lib/payments/payments.ts doesn't need a switch on
// provider.type at every call site -- createTransfer/createPayment/
// createPayout all reduce to "start the money movement with the
// provider", just named differently per docs/06-PROVIDER-INTERFACES.md.
export async function createProviderPayment(
  providerType: ProviderType,
  input: CreateTransferInput
): Promise<ProviderPayment> {
  switch (providerType) {
    case "MOCK_BANK":
      return mockBankProvider.createTransfer(input);
    case "MOCK_CRYPTO":
      return mockCryptoProvider.createPayment(input);
    case "MOCK_PAYOUT":
      return mockPayoutProvider.createPayout(input);
  }
}

export function verifyProviderWebhook(providerType: ProviderType, request: Request): Promise<ProviderEvent> {
  switch (providerType) {
    case "MOCK_BANK":
      return mockBankProvider.verifyWebhook(request);
    case "MOCK_CRYPTO":
      return mockCryptoProvider.verifyWebhook(request);
    case "MOCK_PAYOUT":
      return mockPayoutProvider.verifyWebhook(request);
  }
}
