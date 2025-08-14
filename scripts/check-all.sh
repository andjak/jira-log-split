#!/usr/bin/env bash

# Run lint, test, and build in one go, printing all output and returning non-zero if any step fails.

set -o pipefail

EXIT_CODE=0

run_step() {
  local title="$1"
  shift
  echo "\n==================== ${title} ===================="
  echo "+ $@"
  "$@"
  local status=$?
  if [ $status -ne 0 ]; then
    echo "✖ ${title} failed with exit code ${status}"
    if [ $EXIT_CODE -eq 0 ]; then EXIT_CODE=$status; fi
  else
    echo "✔ ${title} succeeded"
  fi
}

run_step "Lint-staged (auto-fix staged files)" npx --no-install lint-staged
run_step "Lint" npm run lint
run_step "Test" npm run test
run_step "Build" npm run build

echo "\n==================== Summary ===================="
if [ $EXIT_CODE -ne 0 ]; then
  echo "One or more steps failed."
else
  echo "All steps succeeded."
fi

exit $EXIT_CODE


