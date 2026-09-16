# Production Deployment

The user owns a VPS.

Before real financial operations, choose one supported Formance production model:

## Model A
VPS + k3s/Kubernetes + official Formance operator.

## Model B
VPS hosts application/PostgreSQL; Formance Ledger runs in Formance Cloud or another officially supported deployment.

Do not expose PostgreSQL or Formance directly to the Internet.

Public:
- 80
- 443

Private:
- PostgreSQL
- Ledger
- internal application services

Use Caddy:
https://github.com/caddyserver/caddy
