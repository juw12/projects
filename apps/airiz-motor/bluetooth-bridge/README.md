# AIRIZ Bluetooth command bridge (temporary)

Current firmware (0.0.0.3) powers Bluetooth with `diag ble on` but offers no command
channel. This bridge adds one **until the next reboot**, without modifying firmware:

- starts a private D-Bus (`/tmp/airiz/bus`) whose policy lets BlueZ host an app service
  (the stock bus policy blocks it), restarts `bluetoothd` on it;
- advertises **AIRIZ-BT** with a Nordic-UART-style service (`6e400001-…`), the profile
  the AIRIZ phone app looks for;
- runs only allow-listed commands and returns their output as notifications:
  `diag ver sw`, `diag motor pan|rising forward|reverse X Y` (pan X 1–17, rising X 1–30,
  Y 1–99999), `diag spotled|irled on|off|duty 0–100`, `diag led[_r|_g|_b] on|off`.
  Anything else is answered with `#ERR#not allowed…#END#`.
- stops itself after the lifetime (default 1 h). Log: `/tmp/airiz/bridge.log`.

Start it from a PC with the device on USB (close the console app's connection first):

    python start_bridge.py COM4 3600

**Security:** no pairing or PIN. Anyone in range can send the allow-listed commands
while it runs. The proper fix is a firmware-side BLE service plus a D-Bus policy entry.
Physical stop: power/USB unplug. There is no documented motor-stop command.
