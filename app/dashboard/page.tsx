import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canApproveIntercompany, canManageTreasury } from "@/lib/rbac";
import { listBankAccounts } from "@/lib/treasury/bank-accounts";
import { getBankAccountBalance } from "@/lib/treasury/balances";
import { listReservations } from "@/lib/treasury/reservations";
import { listTransfers } from "@/lib/treasury/transfers";
import { listIntercompanyTransfers } from "@/lib/treasury/intercompany";
import {
  addBankAccountAction,
  approveIntercompanyTransferAction,
  initiateIntercompanyTransferAction,
  reconcileIntercompanyTransferAction,
  rejectIntercompanyTransferAction,
  releaseReservationAction,
  reserveFundsAction,
  settleTransferAction,
  startTransferAction,
} from "./actions";

const ASSETS = ["EUR", "USD", "RSD", "USDT", "USDC"] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { companyId: requestedCompanyId, error } = await searchParams;

  // A member of any org (as manager) or a company (as an explicit
  // CompanyMembership) can see that company here -- same access rule as
  // canAccessCompany, expressed as one cross-org query since the
  // dashboard isn't scoped to a single organization.
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { organization: { memberships: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } } },
        { companyMemberships: { some: { userId: user.id } } },
      ],
    },
    orderBy: { legalName: "asc" },
  });

  if (companies.length === 0) {
    return (
      <main className="p-8">
        <p>No companies yet. Ask an OWNER or ADMIN to add you to one.</p>
      </main>
    );
  }

  const company =
    companies.find((c) => c.id === requestedCompanyId) ?? companies[0]!;

  const [bankAccounts, reservations, transfers, intercompanyTransfers, canManage, canApprove] =
    await Promise.all([
      listBankAccounts(company.id),
      listReservations(company.id),
      listTransfers(company.id),
      listIntercompanyTransfers(company.id),
      canManageTreasury(company.id, company.organizationId, user.id),
      canApproveIntercompany(company.organizationId, user.id),
    ]);

  // Every company in the org, for counterparty names and the destination
  // picker -- not just `companies` (the ones *this user* can see), since
  // an intercompany transfer's other side may not be one of them.
  const orgCompanies = await prisma.company.findMany({
    where: { organizationId: company.organizationId },
  });
  const companyNameById = new Map(orgCompanies.map((c) => [c.id, c.legalName]));
  const otherCompanyBankAccounts = await prisma.bankAccount.findMany({
    where: { company: { organizationId: company.organizationId, id: { not: company.id } } },
    include: { company: true },
  });

  const balances = await Promise.all(
    bankAccounts.map(async (account) => {
      try {
        return { id: account.id, balance: (await getBankAccountBalance(account)).balance };
      } catch {
        return { id: account.id, balance: "unavailable" };
      }
    })
  );
  const balanceByAccountId = new Map(balances.map((b) => [b.id, b.balance]));
  const activeReservations = reservations.filter((r) => r.status === "ACTIVE");
  const inTransitTransfers = transfers.filter((t) => t.status === "IN_TRANSIT");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{company.legalName}</h1>
        <div className="flex gap-3 text-sm">
          {companies.map((c) => (
            <a
              key={c.id}
              href={`/dashboard?companyId=${c.id}`}
              className={c.id === company.id ? "font-semibold underline" : "text-blue-600 underline"}
            >
              {c.legalName}
            </a>
          ))}
        </div>
      </div>

      {error ? <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Bank accounts</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-1">Name</th>
              <th>Bank</th>
              <th>Currency</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {bankAccounts.map((account) => (
              <tr key={account.id} className="border-b border-neutral-100">
                <td className="py-1">{account.name}</td>
                <td>{account.bankName}</td>
                <td>{account.currency}</td>
                <td>{balanceByAccountId.get(account.id)}</td>
                <td>{account.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {canManage ? (
          <form action={addBankAccountAction} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="companyId" value={company.id} />
            <label className="flex flex-col gap-1">
              Name
              <input name="name" required className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1">
              Bank
              <input name="bankName" required className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1">
              Currency
              <select name="currency" className="rounded border border-neutral-300 px-2 py-1">
                {ASSETS.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
              Add bank account
            </button>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Reservations</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-1">Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100">
                <td className="py-1">
                  {r.amount.toString()} {r.currency}
                </td>
                <td>{r.status}</td>
                <td>
                  {canManage && r.status === "ACTIVE" ? (
                    <form action={releaseReservationAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <input type="hidden" name="reservationId" value={r.id} />
                      <button type="submit" className="text-blue-600 underline">
                        Release
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {canManage && bankAccounts.length > 0 ? (
          <form action={reserveFundsAction} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="companyId" value={company.id} />
            <label className="flex flex-col gap-1">
              Bank account
              <select name="bankAccountId" className="rounded border border-neutral-300 px-2 py-1">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Amount
              <input name="amount" required placeholder="0.00" className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
              Reserve
            </button>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Transfers</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-1">Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id} className="border-b border-neutral-100">
                <td className="py-1">
                  {t.amount.toString()} {t.currency}
                </td>
                <td>{t.status}</td>
                <td>
                  {canManage && t.status === "IN_TRANSIT" ? (
                    <form action={settleTransferAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <input type="hidden" name="transferId" value={t.id} />
                      <button type="submit" className="text-blue-600 underline">
                        Settle
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {canManage && bankAccounts.length > 1 ? (
          <form action={startTransferAction} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="companyId" value={company.id} />
            <label className="flex flex-col gap-1">
              From
              <select name="bankAccountId" className="rounded border border-neutral-300 px-2 py-1">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              To
              <select name="destinationAccountId" className="rounded border border-neutral-300 px-2 py-1">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Amount
              <input name="amount" required placeholder="0.00" className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
              Start transfer
            </button>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Intercompany transfers</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-1">Direction</th>
              <th>Amount</th>
              <th>Purpose</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {intercompanyTransfers.map((t) => {
              const isSource = t.fromCompanyId === company.id;
              const counterpartyName =
                companyNameById.get(isSource ? t.toCompanyId : t.fromCompanyId) ?? "Unknown company";
              return (
                <tr key={t.id} className="border-b border-neutral-100">
                  <td className="py-1">
                    {isSource ? `→ ${counterpartyName}` : `← ${counterpartyName}`}
                  </td>
                  <td>
                    {t.amount.toString()} {t.currency}
                  </td>
                  <td>{t.purpose ?? ""}</td>
                  <td>
                    {t.status}
                    {t.reconciledAt ? " (reconciled)" : ""}
                  </td>
                  <td className="flex gap-2">
                    {canApprove && t.status === "PENDING_APPROVAL" ? (
                      <>
                        <form action={approveIntercompanyTransferAction}>
                          <input type="hidden" name="companyId" value={company.id} />
                          <input type="hidden" name="transferId" value={t.id} />
                          <button type="submit" className="text-blue-600 underline">
                            Approve
                          </button>
                        </form>
                        <form action={rejectIntercompanyTransferAction}>
                          <input type="hidden" name="companyId" value={company.id} />
                          <input type="hidden" name="transferId" value={t.id} />
                          <button type="submit" className="text-red-600 underline">
                            Reject
                          </button>
                        </form>
                      </>
                    ) : null}
                    {!isSource && canManage && t.status === "APPROVED" && !t.reconciledAt ? (
                      <form action={reconcileIntercompanyTransferAction}>
                        <input type="hidden" name="companyId" value={company.id} />
                        <input type="hidden" name="transferId" value={t.id} />
                        <button type="submit" className="text-blue-600 underline">
                          Reconcile
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {canManage && bankAccounts.length > 0 && otherCompanyBankAccounts.length > 0 ? (
          <form
            action={initiateIntercompanyTransferAction}
            className="flex flex-wrap items-end gap-2 text-sm"
          >
            <input type="hidden" name="companyId" value={company.id} />
            <label className="flex flex-col gap-1">
              From
              <select name="bankAccountId" className="rounded border border-neutral-300 px-2 py-1">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              To
              <select name="destinationAccountId" className="rounded border border-neutral-300 px-2 py-1">
                {otherCompanyBankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.company.legalName} — {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Amount
              <input name="amount" required placeholder="0.00" className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1">
              Purpose
              <input name="purpose" className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
              Request transfer
            </button>
          </form>
        ) : null}
      </section>

      {inTransitTransfers.length === 0 && activeReservations.length === 0 && bankAccounts.length === 0 ? (
        <p className="text-sm text-neutral-500">Add a bank account to get started.</p>
      ) : null}
    </main>
  );
}
