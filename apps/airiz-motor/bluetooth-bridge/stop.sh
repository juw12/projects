#!/bin/sh
# Stop the AIRIZ Bluetooth remote (the radio stays on). Usage: sh /data/airiz/stop.sh
D=/tmp/airiz
touch $D/stop 2>/dev/null
for pid in $(ps | grep '[b]ridge.sh' | awk '{print $1}'); do
  kill $pid 2>/dev/null
done
echo "advertise off" > $D/in 2>/dev/null &
sleep 1
killall bluetoothctl 2>/dev/null
for pid in $(ps | grep -E '[t]ail -n 0 -f /tmp/airiz/out|[s]leep 3600' | awk '{print $1}'); do
  kill $pid 2>/dev/null
done
rm -f $D/stop
[ "$1" = quiet ] || echo "#AIRIZBT#stopped#END#"
