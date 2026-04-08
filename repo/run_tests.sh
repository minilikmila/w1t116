#!/usr/bin/env bash
# ============================================================
# run_tests.sh — Run all tests via Docker Compose
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# -------------------------------------------------------
# If already inside the container, run tests directly
# -------------------------------------------------------
if [ "${INSIDE_DOCKER:-}" = "true" ]; then
  ]="node_modules/.package-lock.sha256"
  CURRENT_LOCKFILE_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
  CACHED_LOCKFILE_HASH="$(cat "$LOCKFILE_HASH_FILE" 2>/dev/null || true)"

  # Reinstall only when the dependency volume is empty or the lockfile changed.
  if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ "$CURRENT_LOCKFILE_HASH" != "$CACHED_LOCKFILE_HASH" ]; then
    npm ci
    printf '%s\n' "$CURRENT_LOCKFILE_HASH" > "$LOCKFILE_HASH_FILE"
  fi

  # Colors
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  NC='\033[0m'
  BOLD='\033[1m'

  PASSED=0
  FAILED=0
  ERRORS=()

  run_suite() {
    local suite_name="$1"
    local pattern="$2"

    echo ""
    echo -e "${CYAN}${BOLD}========================================${NC}"
    echo -e "${CYAN}${BOLD}  Running: ${suite_name}${NC}"
    echo -e "${CYAN}${BOLD}========================================${NC}"
    echo ""

    if npx vitest run --reporter=verbose "$pattern" 2>&1; then
      echo -e "${GREEN}[PASS]${NC} ${suite_name}"
      PASSED=$((PASSED + 1))
    else
      echo -e "${RED}[FAIL]${NC} ${suite_name}"
      FAILED=$((FAILED + 1))
      ERRORS+=("$suite_name")
    fi
  }

  echo -e "${BOLD}Learning Center Platform — Test Runner${NC}"
  echo "========================================"
  echo ""

  # Unit Tests
  run_suite "Unit Tests — RBAC Service" "unit_tests/rbacService.test.ts"
  run_suite "Unit Tests — Billing Logic" "unit_tests/billingLogic.test.ts"
  run_suite "Unit Tests — Feature Flag Logic" "unit_tests/featureFlagService.test.ts"
  run_suite "Unit Tests — Idempotency Logic" "unit_tests/idempotencyLogic.test.ts"
  run_suite "Unit Tests — Room Scheduling Logic" "unit_tests/roomSchedulingLogic.test.ts"
  run_suite "Unit Tests — Rate Limit Logic" "unit_tests/rateLimitLogic.test.ts"
  run_suite "Unit Tests — Message Center Logic" "unit_tests/messageCenterLogic.test.ts"
  run_suite "Unit Tests — Store Initialization" "unit_tests/storeInitialization.test.ts"
  run_suite "Unit Tests — Error Types" "unit_tests/errorTypes.test.ts"

  # API / Service Integration Tests
  run_suite "API Tests — Auth Service" "API_tests/authService.test.ts"
  run_suite "API Tests — Registration Service" "API_tests/registrationService.test.ts"
  run_suite "API Tests — Billing Service" "API_tests/billingService.test.ts"
  run_suite "API Tests — Room Scheduling Service" "API_tests/roomSchedulingService.test.ts"
  run_suite "API Tests — Message Center Service" "API_tests/messageCenterService.test.ts"
  run_suite "API Tests — Feature Flag Service" "API_tests/featureFlagService.test.ts"

  # Integration Tests
  run_suite "Integration — Session Booking Orchestration" "integration_tests/sessionBookingOrchestration.test.ts"
  run_suite "Integration — Message Scheduling" "integration_tests/messageScheduling.test.ts"
  run_suite "Integration — Message Access Control" "integration_tests/messageAccessControl.test.ts"
  run_suite "Integration — Encryption Wiring" "integration_tests/encryptionWiring.test.ts"
  run_suite "Integration — Encryption Storage Boundary" "integration_tests/encryptionStorageBoundary.test.ts"

  # Component / Route Render Tests
  run_suite "Component — Session Create Conflict Modal" "component_tests/SessionCreateConflictModal.test.ts"
  run_suite "Component — Message Detail Access" "component_tests/MessageDetailAccess.test.ts"

  # Summary
  TOTAL=$((PASSED + FAILED))

  echo ""
  echo -e "${BOLD}========================================"
  echo -e "  TEST SUMMARY"
  echo -e "========================================${NC}"
  echo ""
  echo -e "  Total suites: ${TOTAL}"
  echo -e "  ${GREEN}Passed:        ${PASSED}${NC}"
  echo -e "  ${RED}Failed:        ${FAILED}${NC}"
  echo ""

  if [ ${FAILED} -gt 0 ]; then
    echo -e "${RED}${BOLD}FAILED SUITES:${NC}"
    for err in "${ERRORS[@]}"; do
      echo -e "  ${RED}✗${NC} ${err}"
    done
    echo ""
    echo -e "${RED}${BOLD}RESULT: FAIL${NC}"
    exit 1
  else
    echo -e "${GREEN}${BOLD}RESULT: ALL TESTS PASSED${NC}"
    exit 0
  fi
fi

# -------------------------------------------------------
# Host: delegate to Docker Compose
# -------------------------------------------------------

# Detect docker compose command
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "ERROR: Neither 'docker compose' nor 'docker-compose' found." >&2
  exit 1
fi

echo "Using: $DC"
echo "Running tests in Docker container..."

# Run the test service from compose file.
# --rm: clean up container after exit
# -T: no TTY allocation (CI-safe)
COMPOSE_PROFILES=test $DC run --rm -T test

exit $?
