#!/bin/sh
# Start (or restart) the AIRIZ Bluetooth remote. Usage: sh /data/airiz/start.sh [seconds|0] [newpin]
# Prints one machine-readable result line: #AIRIZBT#ready#PIN=123456#END# or #AIRIZBT#failed#...#END#
A=/data/airiz
D=/tmp/airiz
LIFETIME=${1:-0}
mkdir -p $D
if [ "$2" = newpin ] || ! grep -Eq '^[0-9]{6}$' $A/pin 2>/dev/null; then
  n=$(head -c 4 /dev/urandom | od -An -tu4 | tr -d ' ')
  printf '%06d\n' $((n % 1000000)) > $A/pin
  sync
fi
PIN=$(cat $A/pin)
# Stop an earlier bridge.
sh $A/stop.sh quiet
# Power the radio with the stock command, then move bluetoothd to a private bus
# whose policy allows registering the GATT service.
diag ble on > $D/ble_on.log 2>&1
if ! ps | grep -q '[a]iriz/bus.conf'; then
  rm -f $D/bus
  dbus-daemon --config-file=$A/bus.conf --fork
fi
killall bluetoothd 2>/dev/null
sleep 2
DBUS_SYSTEM_BUS_ADDRESS=unix:path=$D/bus bluetoothd -n -f /etc/bluetooth/main.conf > $D/bluetoothd.log 2>&1 &
sleep 3
setsid sh $A/bridge.sh $LIFETIME > $D/bridge.stdout 2>&1 < /dev/null &
i=0
while [ $i -lt 20 ]; do
  sleep 1
  if grep -q 'Advertising object registered' $D/out 2>/dev/null && grep -q 'Application registered' $D/out 2>/dev/null; then
    echo "#AIRIZBT#ready#PIN=$PIN#END#"
    exit 0
  fi
  i=$((i + 1))
done
echo "#AIRIZBT#failed#see /tmp/airiz/out#END#"
exit 1
