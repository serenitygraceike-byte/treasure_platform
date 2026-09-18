import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canApproveIntercompany, canManageTreasury } from "@/lib/rbac";
import { listBankAccounts } from "@/lib/treasury/bank-accounts";
import { getBankAccountBalance } from "@/lib/treasury/balances";
import { listReservations } from "@/lib/treasury/reservations";
import { listTransfers } from "@/lib/treasury/transfers";
import { listIntercompanyTransfers } from "@/lib/treasury/intercompany";
import { canApproveExpense, canApprovePayment, canManageExpenses, canRequestPayment, isOrgManager } from "@/lib/rbac";
import { listExpenseCategories } from "@/lib/expenses/categories";
import { listExpenses } from "@/lib/expenses/expenses";
import { getActualVsBudget, listBudgets } from "@/lib/expenses/budgets";
import { listCounterparties, listBeneficiaries } from "@/lib/counterparties";
import { listPayments } from "@/lib/payments/payments";
import {
  addBankAccountAction,
  addBeneficiaryAction,
  addCounterpartyAction,
  addExpenseAction,
  addExpenseCategoryAction,
  approveExpenseAction,
  approveIntercompanyTransferAction,
  approvePaymentAction,
  cancelPaymentAction,
  executePaymentAction,
  initiateIntercompanyTransferAction,
  reconcileIntercompanyTransferAction,
  rejectIntercompanyTransferAction,
  rejectPaymentAction,
  releaseReservationAction,
  requestPaymentAction,
  reserveFundsAction,
  setBudgetAction,
  settleTransferAction,
  simulatePaymentWebhookAction,
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

  const now = new Date();
  const periodYear = now.getUTCFullYear();
  const periodMonth = now.getUTCMonth() + 1;

  const [
    bankAccounts,
    reservations,
    transfers,
    intercompanyTransfers,
    canManage,
    canApprove,
    expenseCategories,
    expenses,
    budgets,
    actualVsBudget,
    canManageOpex,
    canApproveOpex,
  ] = await Promise.all([
    listBankAccounts(company.id),
    listReservations(company.id),
    listTransfers(company.id),
    listIntercompanyTransfers(company.id),
    canManageTreasury(company.id, company.organizationId, user.id),
    canApproveIntercompany(company.organizationId, user.id),
    listExpenseCategories(company.organizationId),
    listExpenses(company.id),
    listBudgets(company.id, periodYear, periodMonth),
    getActualVsBudget(company.id, periodYear, periodMonth),
    canManageExpenses(company.id, company.organizationId, user.id),
    canApproveExpense(company.id, company.organizationId, user.id),
  ]);
  const categoryNameById = new Map(expenseCategories.map((c) => [c.id, c.name]));
  const budgetedCategoryIds = new Set(budgets.map((b) => b.categoryId));

  const [counterparties, payments, canManageOrg, canRequestPay, canApprovePay] = await Promise.all([
    listCounterparties(company.organizationId),
    listPayments(company.id),
    isOrgManager(company.organizationId, user.id),
    canRequestPayment(company.id, company.organizationId, user.id),
    canApprovePayment(company.id, company.organizationId, user.id),
  ]);
  const beneficiariesByCounterparty = new Map(
    await Promise.all(
      counterparties.map(async (cp) => [cp.id, await listBeneficiaries(cp.id)] as const)
    )
  );
  const allBeneficiaries = counterparties.flatMap(
    (cp) => (beneficiariesByCounterparty.get(cp.id) ?? []).map((b) => ({ ...b, counterpartyName: cp.legalName }))
  );

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

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Expense categories</h2>
        <p className="text-sm text-neutral-500">
          {expenseCategories.map((c) => c.name).join(", ") || "No categories yet."}
        </p>

        {canManageOpex ? (
          <form action={addExpenseCategoryAction} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="companyId" value={company.id} />
            <label className="flex flex-col gap-1">
              Code
              <input name="code" required className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1">
              Name
              <input name="name" required className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
              Add category
            </button>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Expenses</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-1">Category</th>
              <th>Amount</th>
              <th>Due</th>
              <th>Recurrence</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-neutral-100">
                <td className="py-1">{categoryNameById.get(e.categoryId) ?? "Unknown category"}</td>
                <td>
                  {e.amount.toString()} {e.currency}
                </td>
                <td>{e.dueDate.toISOString().slice(0, 10)}</td>
                <td>{e.recurrence}</td>
                <td>{e.status}</td>
                <td>
                  {canApproveOpex && e.status === "PENDING_APPROVAL" ? (
                    <form action={approveExpenseAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <input type="hidden" name="expenseId" value={e.id} />
                      <button type="submit" className="text-blue-600 underline">
                        Approve
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {canManageOpex && expenseCategories.length > 0 ? (
          <form action={addExpenseAction} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="companyId" value={company.id} />
            <label className="flex flex-col gap-1">
              Category
              <select name="categoryId" className="rounded border border-neutral-300 px-2 py-1">
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Amount
              <input name="amount" required placeholder="0.00" className="rounded border border-neutral-300 px-2 py-1" />
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
            <label className="flex flex-col gap-1">
              Due date
              <input type="date" name="dueDate" required className="rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1">
              Recurrence
              <select name="recurrence" className="rounded border border-neutral-300 px-2 py-1">
                {["ONE_OFF", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
              Record expense
            </button>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">
          Budgets — {periodYear}-{String(periodMonth).padStart(2, "0")}
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-1">Category</th>
              <th>Budget</th>
              <th>Actual</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {actualVsBudget.map((row) => (
              <tr key={row.categoryId} className="border-b border-neutral-100">
                <td className="py-1">{row.categoryName}</td>
                <td>
                  {row.budgetAmount.toString()} {row.currency}
                </td>
                <td>
                  {row.actualAmount.toString()} {row.currency}
                </td>
                <td className={row.variance.isNegative() ? "text-red-600" : "text-green-700"}>
                  {row.variance.toString()} {row.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {canManageOpex && expenseCategories.length > 0 ? (
          <form action={setBudgetAction} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="companyId" value={company.id} />
            <input type="hidden" name="periodYear" value={periodYear} />
            <input type="hidden" name="periodMonth" value={periodMonth} />
            <label className="flex flex-col gap-1">
              Category
              <select name="categoryId" className="rounded border border-neutral-300 px-2 py-1">
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {budgetedCategoryIds.has(c.id) ? " (set)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Amount
              <input name="amount" required placeholder="0.00" className="rounded border border-neutral-300 px-2 py-1" />
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
              Set this month&apos;s budget
            </button>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Counterparties &amp; beneficiaries</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-1">Counterparty</th>
              <th>Method</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {allBeneficiaries.map((b) => (
              <tr key={b.id} className="border-b border-neutral-100">
                <td className="py-1">{b.counterpartyName}</td>
                <td>{b.paymentMethod}</td>
                <td>{b.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {canManageOrg ? (
          <div className="flex flex-wrap gap-6">
            <form action={addCounterpartyAction} className="flex flex-wrap items-end gap-2 text-sm">
              <input type="hidden" name="companyId" value={company.id} />
              <label className="flex flex-col gap-1">
                Legal name
                <input name="legalName" required className="rounded border border-neutral-300 px-2 py-1" />
              </label>
              <label className="flex flex-col gap-1">
                Type
                <select name="type" className="rounded border border-neutral-300 px-2 py-1">
                  <option value="COMPANY">COMPANY</option>
                  <option value="INDIVIDUAL">INDIVIDUAL</option>
                </select>
              </label>
              <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
                Add counterparty
              </button>
            </form>

            {counterparties.length > 0 ? (
              <form action={addBeneficiaryAction} className="flex flex-wrap items-end gap-2 text-sm">
                <input type="hidden" name="companyId" value={company.id} />
                <label className="flex flex-col gap-1">
                  Counterparty
                  <select name="counterpartyId" className="rounded border border-neutral-300 px-2 py-1">
                    {counterparties.map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        {cp.legalName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Method
                  <select name="paymentMethod" className="rounded border border-neutral-300 px-2 py-1">
                    <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                    <option value="CRYPTO_EXCHANGE">CRYPTO_EXCHANGE</option>
                    <option value="CARD_PAYOUT">CARD_PAYOUT</option>
                    <option value="MANUAL">MANUAL</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Payout details (IBAN / wallet / card ref)
                  <input name="payoutDetails" required className="rounded border border-neutral-300 px-2 py-1" />
                </label>
                <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
                  Add beneficiary
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Payments</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-1">Amount</th>
              <th>Method</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-neutral-100">
                <td className="py-1">
                  {p.amount.toString()} {p.currency}
                </td>
                <td>{p.paymentMethod}</td>
                <td>
                  {p.status}
                  {p.status === "FAILED" ? ` (${p.failureCode ?? "unknown"})` : ""}
                </td>
                <td className="flex gap-2">
                  {canApprovePay && p.status === "PENDING_APPROVAL" ? (
                    <>
                      <form action={approvePaymentAction}>
                        <input type="hidden" name="companyId" value={company.id} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <button type="submit" className="text-blue-600 underline">
                          Approve
                        </button>
                      </form>
                      <form action={rejectPaymentAction}>
                        <input type="hidden" name="companyId" value={company.id} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <button type="submit" className="text-red-600 underline">
                          Reject
                        </button>
                      </form>
                    </>
                  ) : null}
                  {canManage && (p.status === "APPROVED" || p.status === "FAILED") ? (
                    <form action={executePaymentAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <input type="hidden" name="paymentId" value={p.id} />
                      <button type="submit" className="text-blue-600 underline">
                        {p.status === "FAILED" ? "Retry" : "Execute"}
                      </button>
                    </form>
                  ) : null}
                  {canManage && (p.status === "PENDING_APPROVAL" || p.status === "APPROVED") ? (
                    <form action={cancelPaymentAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <input type="hidden" name="paymentId" value={p.id} />
                      <button type="submit" className="text-red-600 underline">
                        Cancel
                      </button>
                    </form>
                  ) : null}
                  {canManage && p.status === "PROCESSING" ? (
                    <>
                      <form action={simulatePaymentWebhookAction}>
                        <input type="hidden" name="companyId" value={company.id} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input type="hidden" name="outcome" value="SUCCEEDED" />
                        <button type="submit" className="text-blue-600 underline">
                          Simulate success
                        </button>
                      </form>
                      <form action={simulatePaymentWebhookAction}>
                        <input type="hidden" name="companyId" value={company.id} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input type="hidden" name="outcome" value="FAILED" />
                        <button type="submit" className="text-red-600 underline">
                          Simulate failure
                        </button>
                      </form>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {canRequestPay && bankAccounts.length > 0 && allBeneficiaries.length > 0 ? (
          <form action={requestPaymentAction} className="flex flex-wrap items-end gap-2 text-sm">
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
              Beneficiary
              <select name="beneficiaryId" className="rounded border border-neutral-300 px-2 py-1">
                {allBeneficiaries.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.counterpartyName} — {b.paymentMethod}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Type
              <select name="paymentType" className="rounded border border-neutral-300 px-2 py-1">
                {["SUPPLIER", "FREELANCER", "TAX", "OPERATING_EXPENSE", "CRYPTO", "INTERCOMPANY", "OTHER"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Method
              <select name="paymentMethod" className="rounded border border-neutral-300 px-2 py-1">
                <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                <option value="CRYPTO_EXCHANGE">CRYPTO_EXCHANGE</option>
                <option value="CARD_PAYOUT">CARD_PAYOUT</option>
                <option value="MANUAL">MANUAL</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Amount
              <input name="amount" required placeholder="0.00" className="rounded border border-neutral-300 px-2 py-1" />
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
              Request payment
            </button>
          </form>
        ) : null}
        <p className="text-xs text-neutral-500">
          Mock provider convention: amounts ending .13 fail immediately, .66 go to PROCESSING
          (use Simulate above to resolve), anything else settles immediately.
        </p>
      </section>

      {inTransitTransfers.length === 0 && activeReservations.length === 0 && bankAccounts.length === 0 ? (
        <p className="text-sm text-neutral-500">Add a bank account to get started.</p>
      ) : null}
    </main>
  );
}
