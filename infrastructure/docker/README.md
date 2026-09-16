# Docker Development

The initial compose file intentionally does not hard-code a production Formance deployment.

Formance provides its own local all-in-one Docker setup:
https://github.com/formancehq/ledger/tree/main/examples/standalone

Run Formance using the upstream-supported development setup, then point the application's `FORMANCE_BASE_URL` to it.

Do not reuse the development Formance configuration for production.
