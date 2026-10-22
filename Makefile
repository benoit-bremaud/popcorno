.PHONY: help lint-docker scan-docker-config scan-docker-image

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-20s %s\n", $$1, $$2}'

# Hadolint runs from its official image pinned by digest — single source of truth
# for local runs and CI (the workflow calls this target). Bump tag + digest together.
HADOLINT_IMAGE := ghcr.io/hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d
HADOLINT_FILES ?= Dockerfile

# The Hadolint image has no ENTRYPOINT (only CMD ["/bin/hadolint", "-"]), so
# the `hadolint ...` arguments below replace that CMD — they are not appended.
lint-docker: ## Lint the Dockerfiles with Hadolint (policy in .hadolint.yaml)
	@for f in $(HADOLINT_FILES); do \
		echo "[hadolint] $$f"; \
		docker run --rm -v "$(CURDIR)":/repo:ro -w /repo "$(HADOLINT_IMAGE)" \
			hadolint --config .hadolint.yaml "$$f" || exit 1; \
	done

# Trivy from its official image pinned by digest (not trivy-action).
TRIVY_IMAGE := aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222
TRIVY_CACHE ?= $(HOME)/.cache/trivy
TRIVY_FORMAT ?= table
TRIVY_EXIT ?= 1
TRIVY_OUTPUT ?=
TRIVY_RUN = docker run --rm --user "$$(id -u):$$(id -g)" -v "$(CURDIR)":/repo:ro -v "$(TRIVY_CACHE)":/cache -v "$(CURDIR)/.trivy":/out -w /repo

scan-docker-config: ## Trivy misconfiguration scan of the Dockerfiles
	@mkdir -p "$(TRIVY_CACHE)" .trivy
	$(TRIVY_RUN) -e TRIVY_MISCONFIG_SCANNERS=dockerfile "$(TRIVY_IMAGE)" \
		config --cache-dir /cache --severity HIGH,CRITICAL --exit-code 1 --ignorefile .trivyignore.yaml .

scan-docker-image: ## Trivy vulnerability scan: make scan-docker-image IMAGE=name:tag
	@test -n "$(IMAGE)" || { echo "usage: make scan-docker-image IMAGE=name:tag"; exit 2; }
	@mkdir -p "$(TRIVY_CACHE)" .trivy
	$(TRIVY_RUN) --group-add "$$(stat -c %g /var/run/docker.sock)" -v /var/run/docker.sock:/var/run/docker.sock "$(TRIVY_IMAGE)" \
		image --cache-dir /cache --severity HIGH,CRITICAL --ignore-unfixed --scanners vuln \
		--ignorefile .trivyignore.yaml --exit-code "$(TRIVY_EXIT)" --format "$(TRIVY_FORMAT)" \
		$(if $(TRIVY_OUTPUT),--output "/out/$(TRIVY_OUTPUT)") "$(IMAGE)"
