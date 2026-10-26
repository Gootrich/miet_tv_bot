#!/usr/bin/env bash
# Smoke Этапа 2+ (D): пакетная модель, group_id, add, return-all, return-partial.
# Использует реальные модели с access_policy='all' (id 8, 9).

set -u
BASE="${BASE:-http://127.0.0.1:8000}"
DEV="${DEV_USER:-photographer}"
M1="${M1:-8}"   # Canon 70-200mm f/2.8 (all, qty=2)
M2="${M2:-9}"   # Canon 70-200mm f/4   (all, qty=2)
H_DEV="X-Dev-User: $DEV"
H_JSON="Content-Type: application/json"

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

pyget() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "=== v2: пакетная бронь ==="

# --- 1. Пакетная (2 модели) ---
R=$(curl -sS -X POST -H "$H_DEV" -H "$H_JSON" \
  -d "{\"items\":[{\"model_id\":$M1,\"quantity\":1},{\"model_id\":$M2,\"quantity\":1}],\"planned_start\":\"2027-05-01T10:00:00Z\",\"planned_end\":\"2027-05-01T12:00:00Z\"}" \
  "$BASE/api/bookings")

N=$(echo "$R" | pyget "len(d)")
[ "$N" = "2" ] && ok "batch: list из 2 элементов" || { fail "batch: ожидалось 2, пришло $N"; echo "$R"; }

G1=$(echo "$R" | pyget "d[0]['group_id']")
G2=$(echo "$R" | pyget "d[1]['group_id']")
if [ "$G1" = "$G2" ] && [ -n "$G1" ] && [ "$G1" != "None" ]; then
  ok "batch: group_id одинаковый ($G1)"
else
  fail "batch: group_id разный/пустой ($G1 vs $G2)"
fi
GROUP="$G1"
B1=$(echo "$R" | pyget "d[0]['id']")
B2=$(echo "$R" | pyget "d[1]['id']")
echo "   GROUP=$GROUP  B1=$B1  B2=$B2"

# --- 2. add to booking (добавить M1 ещё раз) ---
R=$(curl -sS -X POST -H "$H_DEV" -H "$H_JSON" \
  -d "{\"model_id\":$M1,\"quantity\":1}" \
  "$BASE/api/bookings/$B1/add")
ADD_ID=$(echo "$R" | pyget "d['id'] if 'id' in d else ''" 2>/dev/null || echo "")
ADD_G=$(echo "$R" | pyget "d['group_id'] if 'group_id' in d else ''" 2>/dev/null || echo "")
if [ -n "$ADD_ID" ] && [ "$ADD_G" = "$GROUP" ]; then
  ok "add: новая бронь #$ADD_ID в группе $GROUP"
else
  fail "add: не попала в группу (id=$ADD_ID, group_id=$ADD_G)"
  echo "$R"
fi

# --- 3. checkout B1 и B2 ---
C1=$(curl -sS -o /tmp/c1.json -w "%{http_code}" -X POST -H "$H_DEV" "$BASE/api/bookings/$B1/checkout")
C2=$(curl -sS -o /tmp/c2.json -w "%{http_code}" -X POST -H "$H_DEV" "$BASE/api/bookings/$B2/checkout")
[ "$C1" = "200" ] && ok "checkout B1: 200" || { fail "checkout B1: $C1"; cat /tmp/c1.json; }
[ "$C2" = "200" ] && ok "checkout B2: 200" || { fail "checkout B2: $C2"; cat /tmp/c2.json; }

# --- 4. return-partial: только B1 ---
R=$(curl -sS -X POST -H "$H_DEV" -H "$H_JSON" \
  -d "{\"booking_ids\":[$B1]}" \
  "$BASE/api/bookings/group/$GROUP/return-partial")
N=$(echo "$R" | pyget "len(d)")
[ "$N" = "1" ] && ok "return-partial: вернулось 1" || { fail "return-partial: ожидалось 1, пришло $N"; echo "$R"; }

# Проверим, что B1 completed, B2 confirmed
S1=$(curl -sS -H "$H_DEV" "$BASE/api/bookings?scope=mine&limit=100" | pyget "next((b['status'] for b in d if b['id']==$B1), '?')")
S2=$(curl -sS -H "$H_DEV" "$BASE/api/bookings?scope=mine&limit=100" | pyget "next((b['status'] for b in d if b['id']==$B2), '?')")
[ "$S1" = "completed" ] && ok "B1 после partial: completed" || fail "B1 статус: $S1"
[ "$S2" = "confirmed" ] && ok "B2 после partial: confirmed" || fail "B2 статус: $S2"

# --- 5. return-all: возвращаем остатки группы ---
R=$(curl -sS -X POST -H "$H_DEV" "$BASE/api/bookings/group/$GROUP/return-all")
N=$(echo "$R" | pyget "len(d)")
# В группе остались B2 (confirmed) и ADD (pending) — вернётся только B2.
[ "$N" -ge "1" ] && ok "return-all: вернулось >=1" || { fail "return-all: 0"; echo "$R"; }

S2b=$(curl -sS -H "$H_DEV" "$BASE/api/bookings?scope=mine&limit=100" | pyget "next((b['status'] for b in d if b['id']==$B2), '?')")
[ "$S2b" = "completed" ] && ok "B2 после return-all: completed" || fail "B2 после all: $S2b"

# --- 6. 403 на чужое (videographer → B1) ---
C=$(curl -sS -o /dev/null -w "%{http_code}" -X POST -H "X-Dev-User: videographer" "$BASE/api/bookings/$B1/checkout")
[ "$C" = "403" ] && ok "checkout чужой под videographer: 403" || fail "checkout чужой: $C (ожидалось 403)"

# --- 7. P0 smoke ---
echo
echo "=== P0 smoke ==="
bash scripts/smoke_bookings.sh 2>&1 | tail -3

echo
echo "═══ Итог v2 ═══"
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
[ "$FAIL" = "0" ] && echo "  ВСЁ ОК"
