#!/usr/bin/env bash
# ============================================================
# run_tests.sh — Run all unit and API tests with summary
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure Node >= 20 via nvm if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  nvm use 20 --silent 2>/dev/null || true
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
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

# ----------------------------------------------------------
# 1. Unit Tests
# ----------------------------------------------------------

run_suite "Unit Tests — RBAC Service" "unit_tests/rbacService.test.ts"
run_suite "Unit Tests — Billing Logic" "unit_tests/billingLogic.test.ts"
run_suite "Unit Tests — Feature Flag Logic" "unit_tests/featureFlagService.test.ts"
run_suite "Unit Tests — Idempotency Logic" "unit_tests/idempotencyLogic.test.ts"
run_suite "Unit Tests — Room Scheduling Logic" "unit_tests/roomSchedulingLogic.test.ts"
run_suite "Unit Tests — Rate Limit Logic" "unit_tests/rateLimitLogic.test.ts"
run_suite "Unit Tests — Message Center Logic" "unit_tests/messageCenterLogic.test.ts"
run_suite "Unit Tests — Store Initialization" "unit_tests/storeInitialization.test.ts"
run_suite "Unit Tests — Error Types" "unit_tests/errorTypes.test.ts"

# ----------------------------------------------------------
# 2. API / Service Integration Tests
# ----------------------------------------------------------

run_suite "API Tests — Auth Service" "API_tests/authService.test.ts"
run_suite "API Tests — Registration Service" "API_tests/registrationService.test.ts"
run_suite "API Tests — Billing Service" "API_tests/billingService.test.ts"
run_suite "API Tests — Room Scheduling Service" "API_tests/roomSchedulingService.test.ts"
run_suite "API Tests — Message Center Service" "API_tests/messageCenterService.test.ts"
run_suite "API Tests — Feature Flag Service" "API_tests/featureFlagService.test.ts"

# ----------------------------------------------------------
# 3. Integration Tests
# ----------------------------------------------------------

run_suite "Integration — Session Booking Orchestration" "integration_tests/sessionBookingOrchestration.test.ts"
run_suite "Integration — Message Scheduling" "integration_tests/messageScheduling.test.ts"
run_suite "Integration — Message Access Control" "integration_tests/messageAccessControl.test.ts"
run_suite "Integration — Encryption Wiring" "integration_tests/encryptionWiring.test.ts"

# ----------------------------------------------------------
# Summary
# ----------------------------------------------------------

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
