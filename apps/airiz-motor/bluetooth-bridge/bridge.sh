#!/bin/sh
# AIRIZ Bluetooth command bridge (temporary: runs from /tmp, gone after reboot).
# Exposes a Nordic-UART-style service named AIRIZ-BT. Each received text line is
# checked against an allow-list (version, pan/rising jogs, LEDs) and run with diag;
# the output is sent back as notifications. Everything else is rejected.
D=/tmp/airiz
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=$D/bus
NUS=6e400001-b5a3-f393-e0a9-e50e24dcca9e
RX=6e400002-b5a3-f393-e0a9-e50e24dcca9e
TX=6e400003-b5a3-f393-e0a9-e50e24dcca9e
LIFETIME=${1:-3600}
Z20="0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00"

say() {
  echo "$*" > $D/in
  usleep 150000
}

hex2txt() {
  echo "$1" | awk 'BEGIN { h = "0123456789abcdef" }
    { for (i = 1; i <= NF; i++) {
        v = (index(h, substr($i, 1, 1)) - 1) * 16 + index(h, substr($i, 2, 1)) - 1
        if (v >= 32 && v < 127) printf "%c", v
    } }'
}

notify_text() {
  set -- $(printf '%s' "$1" | head -c 600 | od -An -v -tx1)
  while [ $# -gt 0 ]; do
    chunk=""
    n=0
    while [ $# -gt 0 ] && [ $n -lt 20 ]; do
      chunk="$chunk 0x$1"
      shift
      n=$((n + 1))
    done
    say "write \"${chunk# }\""
  done
}

allowed() {
  echo "$1" | grep -Eq '^diag ver sw$' && return 0
  echo "$1" | grep -Eq '^diag (spotled|irled) (on|off)$' && return 0
  echo "$1" | grep -Eq '^diag (spotled|irled) duty ([0-9]|[1-9][0-9]|100)$' && return 0
  echo "$1" | grep -Eq '^diag led(_r|_g|_b)? (on|off)$' && return 0
  if echo "$1" | grep -Eq '^diag motor (pan|rising) (forward|reverse) [0-9]{1,2} [0-9]{1,5}$'; then
    set -- $1
    max=30
    [ "$3" = pan ] && max=17
    [ "$5" -ge 1 ] && [ "$5" -le $max ] && [ "$6" -ge 1 ] && [ "$6" -le 99999 ] && return 0
  fi
  return 1
}

handle() {
  cmd=$(echo "$1" | tr -s ' ' | sed 's/^ //; s/ $//')
  [ -z "$cmd" ] && return
  echo "$(date +%T) RX: $cmd" >> $D/bridge.log
  if allowed "$cmd"; then
    out=$($cmd 2>&1 | tr -d '\r' | tail -c 500)
    status=$?
    # Some diag commands print their #INFO# result to the console, not stdout.
    [ -z "$out" ] && out="#INFO#$status#END#"
    echo "$(date +%T) OK: $cmd" >> $D/bridge.log
    notify_text "$out
"
  else
    echo "$(date +%T) REJECTED: $cmd" >> $D/bridge.log
    notify_text "#ERR#not allowed over Bluetooth: $cmd#END#
"
  fi
}

stop_bridge() {
  say "advertise off"
  say "quit"
  kill $HOLDER $TAILER 2>/dev/null
  killall bluetoothctl 2>/dev/null
  echo "$(date +%T) bridge stopped" >> $D/bridge.log
}

# Start bluetoothctl as the GATT server, fed through a FIFO.
killall bluetoothctl 2>/dev/null
rm -f $D/in $D/out
mkfifo $D/in
sleep 100000 > $D/in &
HOLDER=$!
bluetoothctl < $D/in > $D/out 2>&1 &
sleep 2
say "menu gatt"
say "register-service $NUS"
say "yes"
say "register-characteristic $RX write,write-without-response"
say "$Z20"
say "register-characteristic $TX notify"
say "$Z20"
say "register-application"
say "back"
say "advertise.name AIRIZ-BT"
say "advertise.uuids $NUS"
say "advertise on"
say "menu gatt"
say "select-attribute local /org/bluez/app/service0/chrc1"
echo "$(date +%T) bridge started, lifetime ${LIFETIME}s" >> $D/bridge.log

(sleep $LIFETIME; touch $D/stop) &
echo $$ > $D/bridge.pid

collecting=0
acc=""
tail -n 0 -f $D/out | while IFS= read -r raw; do
  [ -f $D/stop ] && break
  line=$(printf '%s' "$raw" | tr -d '\033\r' | sed 's/\[[0-9;]*[mK]//g')
  case "$line" in
    *"chrc0 ("*"written:"*)
      collecting=1
      continue
      ;;
  esac
  [ "$collecting" = 1 ] || continue
  hex=$(printf '%s' "$line" | sed -n 's/^\[[^]]*\]#//; s/^ *\(\([0-9a-f][0-9a-f] \)\{1,16\}\).*$/\1/p')
  if [ -z "$hex" ]; then
    collecting=0
    continue
  fi
  for byte in $hex; do
    if [ "$byte" = "0a" ]; then
      handle "$(hex2txt "$acc")"
      acc=""
    else
      acc="$acc $byte"
    fi
  done
done
stop_bridge
