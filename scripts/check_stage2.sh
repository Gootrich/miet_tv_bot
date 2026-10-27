#!/usr/bin/env bash
# Stage 2.0 — автоматические проверки.
# Безопасно перезапускать. Ничего не коммитит и не пишет в БД.
# Не требует активированного .venv — сам находит интерпретатор.
set -u
cd "$(dirname "$0")/.."

if [ -x ".venv/bin/python" ]; then
  PY="$(pwd)/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PY="$(command -v python)"
else
  echo "python/python3 не найден в PATH и .venv/bin/python отсутствует" >&2
  exit 2
fi
echo "python: $PY"

pass=0
fail=0
fail_names=()

run_step() {
  local name="$1"; shift
  echo
  echo "─── $name ───"
  timeout 180 "$@"
  local rc=$?
  if [ $rc -eq 0 ]; then
    echo "✓ $name"
    pass=$((pass+1))
  elif [ $rc -eq 124 ]; then
    echo "✗ $name (TIMEOUT 180s)"
    fail=$((fail+1)); fail_names+=("$name")
  else
    echo "✗ $name (exit $rc)"
    fail=$((fail+1)); fail_names+=("$name")
  fi
}

run_step "git diff --check"           git diff --check
run_step "pytest tests/test_api.py"   "$PY" -m pytest -q -p no:cacheprovider tests/test_api.py
run_step "pytest (остальные)"         "$PY" -m pytest -q -p no:cacheprovider --ignore=tests/test_api.py

echo
echo "═════ SUMMARY ═════"
echo "passed steps: $pass"
echo "failed steps: $fail"
if [ $fail -ne 0 ]; then
  printf '  - %s\n' "${fail_names[@]}"
  exit 1
fi
exit 0
