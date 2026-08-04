# SairiOS
#
# Two runtimes, two purposes:
#   Docker = service development and tool sandboxing
#   QEMU   = full SairiOS integration testing
#
# `make dev` needs neither. It runs the whole environment on the host in mock
# mode, with no credentials.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

NPM ?= npm

.PHONY: help setup dev test test-watch lint typecheck format format-check build \
        vm-image vm-image-dry-run vm-run vm-run-headless vm-tunnel vm-connect \
        vm-clean vm-clean-all \
        docker-up docker-down doctor clean clean-all validate

help: ## Show the available targets
	@echo ""
	@echo "SairiOS"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

# --- development ------------------------------------------------------------

setup: ## Install dependencies and create .env from the example
	$(NPM) install
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")
	@$(MAKE) --no-print-directory doctor || true

dev: ## Run the shell and all services in mock mode (no API key required)
	@node scripts/dev.mjs

test: ## Run the whole test suite
	$(NPM) run test

test-watch: ## Run the test suite in watch mode
	$(NPM) run test:watch

lint: ## Lint every workspace
	$(NPM) run lint

typecheck: ## Type-check every workspace
	$(NPM) run typecheck

format: ## Format the repository
	$(NPM) run format

format-check: ## Verify formatting without writing
	$(NPM) run format:check

build: ## Build every workspace
	$(NPM) run build

validate: format-check lint typecheck test build ## The full gate a PR must pass

doctor: ## Report what this machine can and cannot run
	@node scripts/doctor.mjs

clean: ## Remove build output
	@node scripts/clean.mjs

clean-all: ## Remove build output, var/, the VM cache and node_modules
	@node scripts/clean.mjs --all

# --- virtual machine --------------------------------------------------------
#
# These scripts have not been executed on the machine this repository was
# scaffolded on: it had no QEMU installed. See vm/README.md for the exact
# verification steps and what correct output looks like.

vm-image: ## Build the SairiOS VM image (downloads a Debian cloud image)
	@bash vm/qemu/build-image.sh

vm-image-dry-run: ## Print every step of the image build without touching anything
	@bash vm/qemu/build-image.sh --dry-run

vm-run: ## Boot the SairiOS VM with a graphical display
	@bash vm/qemu/run-vm.sh

vm-run-headless: ## Boot the VM headless with a serial console (CI smoke test)
	@bash vm/qemu/run-vm-headless.sh

vm-tunnel: ## Reach the guest desktop from this machine's browser (paste works there)
	@bash vm/qemu/tunnel.sh

vm-connect: ## Connect the running guest to a model provider, without typing into the VM
	@bash vm/qemu/connect-model.sh

vm-clean: ## Remove built VM artifacts, keeping the downloaded base image
	@bash vm/qemu/clean.sh

vm-clean-all: ## Remove built VM artifacts AND the cached base image download
	@bash vm/qemu/clean.sh --all

# --- containers -------------------------------------------------------------

docker-up: ## Start the development services in containers
	docker compose -f containers/compose.yaml up --build

docker-down: ## Stop the development containers
	docker compose -f containers/compose.yaml down
