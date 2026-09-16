# 03 — API Specification

Base path:

`/api/v1`

## Organizations

- GET `/organizations`
- GET `/organizations/:id`

## Companies

- GET `/companies`
- POST `/companies`
- GET `/companies/:id`
- PATCH `/companies/:id`

## Bank accounts

- GET `/companies/:id/bank-accounts`
- POST `/companies/:id/bank-accounts`
- PATCH `/bank-accounts/:id`

## Transactions

- GET `/transactions`
- GET `/transactions/:id`

## Payments

- POST `/payments`
- GET `/payments`
- GET `/payments/:id`
- POST `/payments/:id/approve`
- POST `/payments/:id/reject`
- POST `/payments/:id/execute`
- POST `/payments/:id/cancel`

Headers:
- `Authorization`
- `Idempotency-Key`
- `X-Correlation-ID`

## Intercompany

- POST `/intercompany-transfers`
- GET `/intercompany-transfers`
- GET `/intercompany-transfers/:id`
- POST `/intercompany-transfers/:id/approve`
- POST `/intercompany-transfers/:id/reconcile`

## Expenses

- POST `/expenses`
- GET `/expenses`
- GET `/expenses/:id`
- PATCH `/expenses/:id`
- POST `/expenses/:id/approve`

## Freelancers

- POST `/freelancers`
- GET `/freelancers`
- GET `/freelancers/:id`

## Contracts

- POST `/contracts`
- GET `/contracts`
- GET `/contracts/:id`
- POST `/contracts/:id/send-for-signature`
- POST `/contracts/:id/mark-signed`

## Forecast

- GET `/forecast?companyId=...&days=30`
- GET `/forecast/group?days=90`

## Reconciliation

- GET `/reconciliation/exceptions`
- POST `/reconciliation/:id/resolve`

## Webhooks

- POST `/webhooks/:provider`

## Error format

```json
{
  "error": {
    "code": "PAYMENT_NOT_APPROVED",
    "message": "Payment must be approved before execution.",
    "requestId": "..."
  }
}
```

Do not expose provider secrets or raw sensitive payloads.
