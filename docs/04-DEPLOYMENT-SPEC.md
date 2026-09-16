# 04 — Deployment Specification

## Local

Docker Compose services:

```text
web
postgres
formance
```

The exact Formance image/version must be pinned after compatibility testing.

## Production target

The user already owns a VPS.

Initial topology:

```text
                         Internet
                            |
                          Caddy
                       HTTPS / TLS
                            |
                       Next.js/API
                       /                            PostgreSQL     Formance
                                  |
                                Ledger
```

## Important Formance production constraint

Current Formance documentation says production self-hosting is supported through the official Kubernetes operator deployment mode.

Therefore the project must have two deployment options documented:

### Option A — recommended for production financial operations
VPS runs a lightweight Kubernetes distribution (for example k3s), then Formance is deployed using the official operator/chart approach.

### Option B — application-only VPS
Run the application and PostgreSQL on Docker; use Formance Cloud or another supported Formance deployment for the Ledger.

Do not put real financial traffic through an unsupported Formance production topology.

## PostgreSQL

For initial MVP:
- persistent volume
- automated backups
- encrypted backup destination
- restore test

If PostgreSQL becomes business-critical, move to managed/HA PostgreSQL without changing application domain interfaces.

## TLS

Caddy terminates TLS.

Required:
- automatic HTTPS
- HSTS after validation
- secure headers
- no direct public access to PostgreSQL
- no direct public access to Ledger

## Network

Public:
- 80/443

Private:
- PostgreSQL
- Formance
- internal services

## Environment variables

See `.env.example`.

Never store `.env` in Git.

## CI/CD

GitHub Actions:
1. install dependencies
2. typecheck
3. lint
4. unit tests
5. integration tests
6. build
7. build container
8. deploy staging
9. manual production approval

## Health endpoints

- `/api/health`
- `/api/ready`

Health must check:
- application
- PostgreSQL
- Ledger connectivity

Do not expose detailed dependency errors publicly.
