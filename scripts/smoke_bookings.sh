#!/usr/bin/env bash
# Smoke-тесты для системы броней MIET TV.
# Проверяют P0-фиксы этапа 1 и базовую логику.
# Не требуют pytest, работают через curl.
#
# Запуск:
#   cd ~/miet_tv_bot && source .venv/bin/activate
#   bash scripts/smoke_bookings.sh

set -u
API="http://127.0.0.1:8000"
DEV="-H dev-mode:true"
FAILS=0
PASSES=0

pass() { PASSES=$((PASSES+1)); echo "  ✓ $1"; }
fail() { FAILS=$((FAILS+1)); echo "  ✗ $1"; }

check_code() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then pass "$desc ($actual)"; else fail "$desc (ожидалось $expected, получено $actual)"; fi
}

post_booking() {
  local user="$1" json="$2" hdr
  if [ -n "$user" ]; then hdr="-H X-Dev-User:$user"; else hdr=""; fi
  curl -sS -o /tmp/_b.json -w "%{http_code}" -X POST "$API/api/bookings" \
    -H "dev-mode: true" $hdr -H "Content-Type: application/json" \
    -d "$json"
}

# --- БД-чистка (только bookings/history, чтобы тесты были воспроизводимы) ---
echo "═══ Подготовка: чистим bookings и booking_history ═══"
docker exec -i booking-db psql -U booking_user -d booking_db > /dev/null <<'SQL'
DELETE FROM booking_history;
DELETE FROM bookings;
ALTER SEQUENCE bookings_id_seq RESTART WITH 1;
ALTER SEQUENCE booking_history_id_seq RESTART WITH 1;
SQL
echo "  ✓ БД очищена"

echo
echo "═══ 1. Health ═══"
code=$(curl -sS -o /dev/null -w "%{http_code}" "$API/api/health")
check_code "health" 200 "$code"

echo
echo "═══ 2. Dev-пользователи ═══"
code=$(curl -sS -o /dev/null -w "%{http_code}" "$API/api/me" $DEV)
check_code "superadmin /api/me" 200 "$code"

# Найти model_id с access_policy=photographer и videographer
PHOTO_MODEL=$(curl -sS "$API/api/catalog" | python3 -c "
import sys,json
for c in json.load(sys.stdin):
    for m in c['models']:
        if m['access_policy']=='photographer' and m['total_quantity']>=2:
            print(m['id']); exit()
")
VIDEO_MODEL=$(curl -sS "$API/api/catalog" | python3 -c "
import sys,json
for c in json.load(sys.stdin):
    for m in c['models']:
        if m['access_policy']=='videographer' and m['total_quantity']>=2:
            print(m['id']); exit()
")
echo "  photographer model_id=$PHOTO_MODEL, videographer model_id=$VIDEO_MODEL"

echo
echo "═══ 3. Создание брони (своя, quantity=1) ═══"
code=$(post_booking "photographer" "{\"model_id\":$PHOTO_MODEL,\"quantity\":1,\"planned_start\":\"2027-01-10T10:00:00Z\",\"planned_end\":\"2027-01-10T12:00:00Z\"}")
check_code "photographer → photographer-модель" 200 "$code"

echo
echo "═══ 4. access_policy: чужой клуб → 403 ═══"
code=$(post_booking "photographer" "{\"model_id\":$VIDEO_MODEL,\"quantity\":1,\"planned_start\":\"2027-01-10T14:00:00Z\",\"planned_end\":\"2027-01-10T16:00:00Z\"}")
check_code "photographer → videographer-модель" 403 "$code"

echo
echo "═══ 5. Свой клуб → 200 ═══"
code=$(post_booking "videographer" "{\"model_id\":$VIDEO_MODEL,\"quantity\":1,\"planned_start\":\"2027-01-10T14:00:00Z\",\"planned_end\":\"2027-01-10T16:00:00Z\"}")
check_code "videographer → videographer-модель" 200 "$code"

echo
echo "═══ 6. Превышение остатка ═══"
code=$(post_booking "photographer" "{\"model_id\":$PHOTO_MODEL,\"quantity\":999,\"planned_start\":\"2027-01-11T10:00:00Z\",\"planned_end\":\"2027-01-11T12:00:00Z\"}")
check_code "quantity=999" 409 "$code"

echo
echo "═══ 7. Шаг 15 минут: 10:07 → 400 ═══"
code=$(post_booking "photographer" "{\"model_id\":$PHOTO_MODEL,\"quantity\":1,\"planned_start\":\"2027-01-11T10:07:00Z\",\"planned_end\":\"2027-01-11T12:00:00Z\"}")
check_code "невалидный шаг" 400 "$code"

echo
echo "═══ 8. start >= end ═══"
code=$(post_booking "photographer" "{\"model_id\":$PHOTO_MODEL,\"quantity\":1,\"planned_start\":\"2027-01-12T12:00:00Z\",\"planned_end\":\"2027-01-12T12:00:00Z\"}")
check_code "start == end" 400 "$code"

echo
echo "═══ 9. Race condition: параллельные на последнюю единицу ═══"
# Занять 1 единицу на 2027-02-01 10-12
post_booking "photographer" "{\"model_id\":$PHOTO_MODEL,\"quantity\":1,\"planned_start\":\"2027-02-01T10:00:00Z\",\"planned_end\":\"2027-02-01T12:00:00Z\"}" > /dev/null
# Найти total_quantity
TOTAL=$(curl -sS "$API/api/catalog" | python3 -c "
import sys,json
for c in json.load(sys.stdin):
    for m in c['models']:
        if m['id']==$PHOTO_MODEL:
            print(m['total_quantity']); exit()
")
REMAIN=$((TOTAL - 1))
echo "  total=$TOTAL, уже занято=1, останется=$REMAIN"

# Два параллельных
(post_booking "photographer" "{\"model_id\":$PHOTO_MODEL,\"quantity\":1,\"planned_start\":\"2027-02-01T10:00:00Z\",\"planned_end\":\"2027-02-01T12:00:00Z\"}" > /tmp/a.code) &
(post_booking "photographer" "{\"model_id\":$PHOTO_MODEL,\"quantity\":1,\"planned_start\":\"2027-02-01T10:00:00Z\",\"planned_end\":\"2027-02-01T12:00:00Z\"}" > /tmp/b.code) &
wait

A=$(cat /tmp/a.code); B=$(cat /tmp/b.code)
echo "  A=$A, B=$B"
if { [ "$A" = "200" ] && [ "$B" = "409" ]; } || { [ "$A" = "409" ] && [ "$B" = "200" ]; }; then
  pass "ровно один прошёл, второй 409 ($A/$B)"
else
  fail "ожидалось 200/409, получено $A/$B"
fi

# Сколько броней на 10-12 в БД
CNT=$(docker exec -i booking-db psql -U booking_user -d booking_db -t -c \
  "SELECT count(*) FROM bookings WHERE model_id=$PHOTO_MODEL AND planned_start='2027-02-01T10:00:00Z';" | tr -d ' \n')
if [ "$CNT" = "$TOTAL" ]; then
  pass "в БД $CNT брони (равно total=$TOTAL)"
else
  fail "в БД $CNT броней, ожидалось $TOTAL"
fi

echo
echo "═══ Итог ═══"
echo "  PASSED: $PASSES"
echo "  FAILED: $FAILS"
if [ "$FAILS" -gt 0 ]; then exit 1; fi
