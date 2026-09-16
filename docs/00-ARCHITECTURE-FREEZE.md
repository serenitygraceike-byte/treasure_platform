# 00 — Architecture Freeze

## Decision

The MVP uses a modular monolith plus Formance Ledger.

### Application

- Next.js
- TypeScript
- Node.js 24 LTS
- PostgreSQL
- Prisma 7 stable
- Better Auth

### Financial core

- Formance Ledger as an independent service
- Application integrates through a Ledger Adapter

### Infrastructure

- Docker Compose for development
- Linux VPS for initial production
- Caddy for TLS/reverse proxy
- GitHub Actions for CI/CD
- Kubernetes is postponed

## Why modular monolith

The business domain is still being discovered. A monolith gives:
- simpler transactions
- simpler debugging
- lower infrastructure overhead
- one deployment
- clear module boundaries

The code must still be modular so a provider or domain can be extracted later.

## Why Formance Ledger

Formance Ledger is specifically designed as a programmable financial core with atomic multi-posting transactions and account-based modeling. It can run as a standalone microservice and uses PostgreSQL as transactional storage.

Official repository:
https://github.com/formancehq/ledger

Official deployment documentation:
https://docs.formance.com/deploy/overview

## Authentication decision

Use Better Auth.

Reason:
- self-hosted
- TypeScript
- PostgreSQL support
- Next.js integration
- multi-tenant/advanced auth capabilities
- no hosted auth dependency

Repository:
https://github.com/better-auth/better-auth

Important current ecosystem note:
the Auth.js repository states that Auth.js is now part of Better Auth and recommends Better Auth for new projects. Therefore the original Auth.js choice has been superseded.

## Application DB vs Ledger

### Application PostgreSQL

Stores:
- organizations
- companies
- users/roles
- bank accounts
- counterparties
- contracts
- freelancers
- expenses
- payment requests
- provider configuration metadata
- webhooks
- reconciliation cases
- documents
- audit events

### Formance Ledger

Stores:
- monetary accounts
- postings
- monetary transactions
- financial balances

## No direct provider-to-ledger writes

Providers are called by the application.

The application validates the business operation and creates/updates the corresponding ledger transaction.

## Future extraction

Potential future services:
- payment orchestration
- reconciliation
- provider gateway
- document/signature service

Do not extract until there is a measurable operational reason.
