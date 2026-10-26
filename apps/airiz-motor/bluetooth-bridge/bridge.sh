#!/bin/sh
# AIRIZ Bluetooth command bridge v2.
# Installed in /data/airiz (persistent); runtime files live in /tmp/airiz.
# Exposes a Nordic-UART-style service named AIRIZ-BT. Each received text line is
# checked against an allow-list and run locally; output goes back as notifications.
#
# Security: a 6-digit PIN (/data/airiz/pin) must be sent as "auth <PIN>" after
# every Bluetooth connection before motor/LED commands run. Without the PIN only
# the firmware-version query and the motor stop are accepted. Five wrong PINs
# lock authentication for 60 s.
A=/data/airiz
D=/tmp/airiz
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=$D/bus
NUS=6e400001-b5a3-f393-e0a9-e50e24dcca9e
MOTOR=/sys/devices/platform/soc/soc:motor
LIFETIME=${1:-0}
PIN=$(cat $A/pin 2>/dev/null)
Z20="0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00"

log() {
  echo "$(date +%T) $*" >> $D/bridge.log
}

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
  set -- $(printf '%s' "$1" | head -c 700 | od -An -v -tx1)
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

# Commands that need the PIN.
allowed() {
  echo "$1" | grep -Eq '^diag motor info$' && return 0
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

stop_motor() {
  # The motor driver runs moves from a kernel timer; writing 0 stops it at once.
  echo 0 > $MOTOR/status 2>/dev/null
  echo $?
}

authed=0
failures=0
locked_until=0

handle() {
  cmd=$(echo "$1" | tr -s ' ' | sed 's/^ //; s/ $//')
  [ -z "$cmd" ] && return
  case "$cmd" in
    "auth "*) log "RX: auth ******" ;;
    *) log "RX: $cmd" ;;
  esac
  case "$cmd" in
    "diag ver sw")
      out=$(diag ver sw 2>&1 | tr -d '\r' | tail -c 300)
      [ -z "$out" ] && out="#INFO#unknown#END#"
      if [ "$authed" = 1 ]; then
        out="$out
#AUTH#ok#END#"
      else
        out="$out
#AUTH#required#END#"
      fi
      notify_text "$out
"
      return
      ;;
    "stop"|"diag motor stop")
      notify_text "#INFO#$(stop_motor)#END#
"
      log "motor stop"
      return
      ;;
    "auth "*)
      now=$(date +%s)
      if [ "$now" -lt "$locked_until" ]; then
        notify_text "#AUTH#locked $((locked_until - now))#END#
"
        return
      fi
      if [ -n "$PIN" ] && [ "${cmd#auth }" = "$PIN" ]; then
        authed=1
        failures=0
        log "auth ok"
        notify_text "#AUTH#ok#END#
"
      else
        failures=$((failures + 1))
        log "auth failed ($failures)"
        if [ $failures -ge 5 ]; then
          failures=0
          locked_until=$((now + 60))
          notify_text "#AUTH#locked 60#END#
"
        else
          notify_text "#AUTH#denied#END#
"
        fi
      fi
      return
      ;;
  esac
  if [ "$authed" != 1 ]; then
    log "NEEDS PIN: $cmd"
    notify_text "#AUTH#required#END#
"
    return
  fi
  if allowed "$cmd"; then
    out=$($cmd 2>&1 | tr -d '\r' | tail -c 600)
    status=$?
    # Some diag commands print their #INFO# result to the console, not stdout.
    [ -z "$out" ] && out="#INFO#$status#END#"
    log "OK: $cmd"
    notify_text "$out
"
  else
    log "REJECTED: $cmd"
    notify_text "#ERR#not allowed over Bluetooth: $cmd#END#
"
  fi
}

stop_bridge() {
  say "advertise off"
  say "quit"
  kill $HOLDER $TIMER 2>/dev/null
  killall bluetoothctl 2>/dev/null
  log "bridge stopped"
}

# Start bluetoothctl as the GATT server, fed through a FIFO.
killall bluetoothctl 2>/dev/null
rm -f $D/in $D/out $D/stop
mkfifo $D/in
while true; do sleep 3600; done > $D/in &
HOLDER=$!
bluetoothctl < $D/in > $D/out 2>&1 &
sleep 2
# The GAP device name (what iPhones show after the first connection) defaults to
# "BlueZ x.y"; make it match the advertised name.
say "system-alias AIRIZ-BT"
say "menu gatt"
say "register-service $NUS"
say "yes"
say "register-characteristic 6e400002-b5a3-f393-e0a9-e50e24dcca9e write,write-without-response"
say "$Z20"
say "register-characteristic 6e400003-b5a3-f393-e0a9-e50e24dcca9e notify"
say "$Z20"
say "register-application"
say "back"
say "advertise.name AIRIZ-BT"
say "advertise.uuids $NUS"
say "advertise on"
say "menu gatt"
say "select-attribute local /org/bluez/app/service0/chrc1"
echo $$ > $D/bridge.pid
TIMER=
if [ "$LIFETIME" -gt 0 ]; then
  (sleep $LIFETIME; touch $D/stop; echo "" >> $D/out) &
  TIMER=$!
  log "bridge started, lifetime ${LIFETIME}s"
else
  log "bridge started, no time limit"
fi

collecting=0
acc=""
tail -n 0 -f $D/out | while IFS= read -r raw; do
  [ -f $D/stop ] && break
  line=$(printf '%s' "$raw" | tr -d '\033\r' | sed 's/\[[0-9;]*[mK]//g')
  case "$line" in
    *"Connected: no"*|*"Connected: yes"*)
      # New or dropped connection: the next client must send the PIN again.
      authed=0
      acc=""
      collecting=0
      log "link: ${line##*Device }"
      continue
      ;;
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
