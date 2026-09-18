# 12 — Real Entities (Production)

Real legal entities, provisioned on production 2026-09-19, replacing
the demo "Acme Group" org as the one actually used going forward. The
demo org/companies/seed users (`prisma/seed.ts`) were deliberately left
in place, untouched, rather than deleted — see "Demo data" below.

## Why this doc exists

`prisma/seed.ts` is git-tracked and re-run on every deploy
(`docs/11-DEPLOYMENT-WORKFLOW.md`'s `migrate` step) — real bank account
numbers must never enter that file, or git history generally. This doc
records the real, publicly-verifiable business facts (legal name,
registration/VAT numbers, address, bank name, BIC — all public-record
information) so future phases have the right context. **Full IBANs are
never written here or anywhere in git** — they live only in the
production database (`BankAccount.iban`), entered once via a one-off
script run directly on the server and then deleted (not committed).
Only the last 4 digits are recorded below, matching
`BankAccount.accountNumberLast4`.

## Organization

- Name: **Serenity Grace Group**
- id: `22222222-2222-4222-8222-000000000001`
- Base currency: EUR
- Owner account: `serenitygrace.ike@gmail.com` (role `OWNER`) — a real
  account, unrelated to the demo seed users/password in `prisma/seed.ts`

## Companies

### 1. IRA media partners IKE — main contractor (Greece)

- Country: GR
- Registration number: 156084901000
- VAT/ΑΦΜ: EL801403998
- Address: 3is Septemvriou 144, Athina 112 51, Greece
- Base currency: EUR
- Bank account:
  - Piraeus Bank (4 Amerikis Street, 105 64 Athens) — BIC `PIRBGRAA` —
    IBAN ending `...2899`

### 2. SERENITY GRACE ΜΟΝΟΠΡΟΣΩΠΗ Ι.Κ.Ε. — the hub (Greece)

- Country: GR
- GEMI number: 182868107000
- VAT: EL802792961
- Address: Agiou Dimitriou 41, Peiraios, 18546, Greece
- Base currency: EUR
- Bank accounts:
  - Piraeus Bank (Trion Ierarchon 110, Athina 118 51) — BIC `PIRBGRAA`
    — IBAN ending `...1196`
  - Alpha Bank — BIC `CRBAGRAA` — IBAN ending `...5612`
  - National Bank of Greece (NBG) — BIC `ETHNGRAA` — IBAN ending
    `...6056`

### 3. FORCE MEDIA CEE DOO (Serbia)

- Country: RS
- Registration/tax numbers: not provided yet — left blank on the
  `companies` row (`registration_number`/`tax_identifier` nullable)
- Address: Mite Ruzica 1/9, Novi Sad, Serbia
- Base currency: **EUR** (not RSD — confirmed explicitly; the bank
  account is a Serbian RS-IBAN but invoicing/base currency is EUR)
- Bank account:
  - Raiffeisen Banka AD Beograd (Đorđa Stanojevića 16, 11070 Novi
    Beograd) — BIC `RZBSRSBG` — IBAN ending `...5206` (domestic format
    on file: `265-2010310009340-71`)

## 4. Further companies

None yet as of this doc's creation. Add them the same way: real
records via a one-off script run directly on the server (never via
`prisma/seed.ts`), documented here without the full IBAN.

## Demo data

`prisma/seed.ts`'s "Acme Group" organization, its 4 fictional
companies, and the `owner@example.local`/`admin@example.local`/
`accountant@example.local`/`viewer@example.local` users (password
`SeedDev1234!`, public in git) are left in production, untouched.
They're harmless clutter, not a security issue on their own — but
**never grant those demo users access to this real organization or any
future real one**; their password is public in this repository's
history.
