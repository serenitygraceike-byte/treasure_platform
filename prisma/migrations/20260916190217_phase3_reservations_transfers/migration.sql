-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'SETTLED');

-- Same as the previous migration: Prisma's shadow-db diff proposed
-- dropping the hand-added Better-Auth-"user" FKs again (deliberately
-- invisible to Prisma, see schema.prisma's top-of-file comment). Removed
-- by hand; do not apply them.

-- CreateTable
CREATE TABLE "bank_reservations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "ledgerTransactionId" TEXT NOT NULL,
    "releaseLedgerTransactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "bank_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transfers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "destinationAccountId" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "startLedgerTransactionId" TEXT NOT NULL,
    "settleLedgerTransactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "bank_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_reservations_companyId_status_idx" ON "bank_reservations"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reservations_bankAccountId_idempotencyKey_key" ON "bank_reservations"("bankAccountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "bank_transfers_companyId_status_idx" ON "bank_transfers"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transfers_bankAccountId_idempotencyKey_key" ON "bank_transfers"("bankAccountId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "bank_reservations" ADD CONSTRAINT "bank_reservations_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
