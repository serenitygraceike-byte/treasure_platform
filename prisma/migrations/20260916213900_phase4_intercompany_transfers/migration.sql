-- CreateEnum
CREATE TYPE "IntercompanyTransferStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- Same as every previous migration: Prisma's shadow-db diff proposed
-- dropping the hand-added Better-Auth-"user" FKs again (deliberately
-- invisible to Prisma, see schema.prisma's top-of-file comment). Removed
-- by hand; do not apply them.

-- CreateTable
CREATE TABLE "intercompany_transfers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromCompanyId" TEXT NOT NULL,
    "toCompanyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "destinationAccountId" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "purpose" TEXT,
    "status" "IntercompanyTransferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "dueAt" TIMESTAMP(3),
    "startLedgerTransactionId" TEXT,
    "settleLedgerTransactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "intercompany_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intercompany_transfers_organizationId_status_idx" ON "intercompany_transfers"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "intercompany_transfers_bankAccountId_idempotencyKey_key" ON "intercompany_transfers"("bankAccountId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_fromCompanyId_fkey" FOREIGN KEY ("fromCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_toCompanyId_fkey" FOREIGN KEY ("toCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
