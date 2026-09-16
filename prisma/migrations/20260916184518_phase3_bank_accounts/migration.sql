-- Prisma's shadow-db diff also proposed dropping
-- memberships_userId_fkey / company_memberships_userId_fkey /
-- audit_events_actorUserId_fkey here. Those are the hand-added FKs into
-- Better Auth's "user" table documented at the top of schema.prisma —
-- deliberately invisible to Prisma (see that comment for why), so every
-- future `prisma migrate dev` diff will propose removing them. Removed
-- by hand from this generated file; do not apply them.

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "providerId" TEXT,
    "name" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "iban" TEXT,
    "accountNumberLast4" TEXT,
    "currency" CHAR(3) NOT NULL,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "ledgerAccountAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_companyId_idx" ON "bank_accounts"("companyId");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
