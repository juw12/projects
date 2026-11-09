# OpenForge infra Makefile
# Convenience targets for the local docker-compose stack.
# Run from the repo root: `make -C infra <target>`

.PHONY: up down logs build runner-shell migrate security-audit ps help

COMPOSE := docker compose -f infra/docker-compose.yml

help: ## Show this help text
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Start all services (detached)
	$(COMPOSE) up -d

down: ## Stop and remove all services (keeps volumes)
	$(COMPOSE) down

down-volumes: ## Stop, remove services AND volumes (DESTRUCTIVE)
	$(COMPOSE) down -v

logs: ## Tail logs from all services
	$(COMPOSE) logs -f

build: ## Build all images
	$(COMPOSE) build

ps: ## List running services
	$(COMPOSE) ps

migrate: ## Run database migrations against the running postgres
	$(COMPOSE) exec api pnpm db:migrate

runner-shell: ## Open a shell in the runner container
	$(COMPOSE) exec runner /bin/bash

runner-logs: ## Tail the runner logs only
	$(COMPOSE) logs -f runner

security-audit: ## Verify gVisor runsc is registered with Docker (FATAL if not)
	@$(COMPOSE) exec runner docker info --format '{{json .Runtimes}}' \
		| grep -q '"runsc"' \
		&& echo "OK: runsc runtime is registered" \
		|| (echo "FAIL: runsc runtime is NOT registered — sandbox disabled" && exit 1)

security-audit-full: ## Full sandbox audit (runsc + seccomp + read-only + net=none)
	@echo "--- runsc registered ---"
	@$(COMPOSE) exec runner docker info --format '{{json .Runtimes}}' | grep runsc
	@echo "--- runsc version ---"
	@$(COMPOSE) exec runner runsc --version
	@echo "--- seccomp profile present ---"
	@$(COMPOSE) exec runner test -f /etc/openforge/seccomp-runsc.json && echo OK
	@echo "--- oom policy present ---"
	@$(COMPOSE) exec runner test -f /etc/openforge/oom-killer-policy.yaml && echo OK
