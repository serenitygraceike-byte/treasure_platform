-- CreateEnum
ALTER TYPE "ProviderType" ADD VALUE 'PIRAEUS_BANK';

-- Rolling back this one value later is not a plain DROP (Postgres has
-- no ALTER TYPE ... DROP VALUE) -- the accepted, documented recovery
-- strategy per CLAUDE.md rule 16 is: no phase in this project has ever
-- removed an enum value; if PIRAEUS_BANK is ever abandoned, leave the
-- unused enum label in place rather than rebuilding the type.

-- CreateEnum
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ProviderAccountLinkStatus" AS ENUM ('ACTIVE', 'UNLINKED');

-- CreateEnum
CREATE TYPE "CreditDebitIndicator" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'SYNCING', 'ERROR');

-- Same as every previous migration: Prisma's shadow-db diff proposed
-- dropping the hand-added Better-Auth-"user" FKs again (deliberately
-- invisible to Prisma, see schema.prisma's top-of-file comment). Removed
-- by hand; do not apply them.

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerType" "ProviderType" NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "ProviderConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "grantedScope" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "connectedBy" TEXT,
    "connectedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_account_links" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalAccountFingerprint" TEXT NOT NULL,
    "status" "ProviderAccountLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "linkedBy" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),

    CONSTRAINT "provider_account_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_observations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "providerAccountLinkId" TEXT NOT NULL,
    "balanceType" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_transactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "providerAccountLinkId" TEXT NOT NULL,
    "externalTransactionId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "creditDebitIndicator" "CreditDebitIndicator" NOT NULL,
    "remittanceInfo" TEXT,
    "counterpartyName" TEXT,
    "counterpartyIban" TEXT,
    "providerReferenceCode" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_states" (
    "id" TEXT NOT NULL,
    "providerAccountLinkId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncedBookingDate" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAllowedSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oauth_states_expiresAt_idx" ON "oauth_states"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_organizationId_providerId_key" ON "provider_connections"("organizationId", "providerId");

-- CreateIndex
CREATE INDEX "provider_account_links_bankAccountId_idx" ON "provider_account_links"("bankAccountId");

-- CreateIndex
CREATE INDEX "provider_account_links_providerConnectionId_idx" ON "provider_account_links"("providerConnectionId");

-- Only one ACTIVE link per BankAccount -- Prisma has no partial-unique-
-- index syntax, so this is hand-written. A bank account can be
-- relinked after an UNLINKED row without colliding.
CREATE UNIQUE INDEX "provider_account_links_bankAccountId_active_key"
  ON "provider_account_links"("bankAccountId")
  WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE INDEX "balance_observations_bankAccountId_observedAt_idx" ON "balance_observations"("bankAccountId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_transactions_bankAccountId_fingerprint_key" ON "external_transactions"("bankAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "external_transactions_bankAccountId_bookingDate_idx" ON "external_transactions"("bankAccountId", "bookingDate");

-- CreateIndex
CREATE UNIQUE INDEX "sync_states_providerAccountLinkId_key" ON "sync_states"("providerAccountLinkId");

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_account_links" ADD CONSTRAINT "provider_account_links_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_account_links" ADD CONSTRAINT "provider_account_links_providerConnectionId_fkey" FOREIGN KEY ("providerConnectionId") REFERENCES "provider_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_observations" ADD CONSTRAINT "balance_observations_providerAccountLinkId_fkey" FOREIGN KEY ("providerAccountLinkId") REFERENCES "provider_account_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_transactions" ADD CONSTRAINT "external_transactions_providerAccountLinkId_fkey" FOREIGN KEY ("providerAccountLinkId") REFERENCES "provider_account_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_states" ADD CONSTRAINT "sync_states_providerAccountLinkId_fkey" FOREIGN KEY ("providerAccountLinkId") REFERENCES "provider_account_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
