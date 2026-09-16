# 07 — Security, Audit and Data Protection

## Secrets

Never commit:
- database password
- Better Auth secret
- Formance credentials
- provider API keys
- crypto credentials
- signing secrets

## Authentication

Better Auth.

Official:
https://github.com/better-auth/better-auth

Use:
- secure cookies
- email/password initially
- optional 2FA later
- session expiration
- password reset
- email verification before production

## Authorization

Application RBAC:
- OWNER
- ADMIN
- TREASURY_MANAGER
- APPROVER
- ACCOUNTANT
- VIEWER

Permissions are action-based.

## Financial approval

At minimum:
- creator may request
- approver authorizes
- execution occurs only after approval

For high-value operations later:
- two-person approval

## Audit

Record:
- who
- what
- when
- company
- object
- correlation ID
- relevant before/after metadata

Never store passwords or raw secrets in audit logs.

## Backups

Application DB:
- daily full
- frequent incremental/WAL/PITR when justified
- encrypted
- off-server
- tested restore

Ledger:
follow the storage/deployment model of the selected Formance version.

## Logs

Do not log:
- full bank account numbers
- private keys
- API secrets
- raw payout credentials
- passwords

Use structured JSON logs.
