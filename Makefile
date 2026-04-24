# Dev-loop aliases. Requires: pnpm, docker.
# Run `make help` for a list.

.DEFAULT_GOAL := help
SHELL := /usr/bin/env bash

.PHONY: help bootstrap infra-up infra-down migrate api dev-worker-checkins \
        dev-worker-escalation dev-worker-release dev-worker-relay test test-int \
        dev-e2e typecheck lint clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  %-24s %s\n", $$1, $$2}'

bootstrap: ## install deps, generate prisma client
	pnpm install
	pnpm --filter @deadswitch/api prisma:generate

infra-up: ## start local Postgres + Redis (test compose)
	pnpm --filter @deadswitch/api run test:integration:up

infra-down: ## stop + wipe local infra volumes
	pnpm --filter @deadswitch/api run test:integration:down

migrate: ## apply prisma migrations to local DB
	cd apps/api && pnpm prisma migrate deploy

api: ## run the API (dev mode, watch)
	cd apps/api && pnpm start:dev

dev-worker-checkins: ## run checkins worker locally
	cd apps/api && PROCESS_ROLE=checkins-worker pnpm start:checkins-worker

dev-worker-escalation: ## run escalation worker locally
	cd apps/api && PROCESS_ROLE=escalation-worker pnpm start:escalation-worker

dev-worker-release: ## run release worker locally (the only KMS-decrypt role)
	cd apps/api && PROCESS_ROLE=release-worker pnpm start:release-worker

dev-worker-relay: ## run outbox relay
	cd apps/api && PROCESS_ROLE=outbox-relay node dist/workers/outbox-relay.worker.js

test: ## unit tests
	pnpm --filter @deadswitch/api run test

test-int: ## integration tests (requires infra-up)
	pnpm --filter @deadswitch/api run test:integration

dev-e2e: ## run the end-to-end smoke script against local stack
	bash scripts/dev-e2e.sh

typecheck: ## tsc --noEmit across the repo
	pnpm -r typecheck

lint: ## lint + chokepoint import checks
	pnpm -r lint
	bash scripts/check-imports.sh

clean: ## nuke build outputs
	rm -rf apps/*/dist apps/*/.turbo packages/*/dist
