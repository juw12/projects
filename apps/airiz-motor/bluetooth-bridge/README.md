# AIRIZ Bluetooth remote (bridge v3)

The stock firmware (0.0.0.3) powers the Bluetooth radio with `diag ble on` but has
no command service. This bridge adds one without changing the firmware:

* private D-Bus + `bluetoothd` restart, `bluetoothctl` as GATT server
* Nordic UART service, advertised as **AIRIZ-BT**
  (RX `6e400002…` write, TX `6e400003…` notify, 20-byte chunks)
* allow-list: `diag ver sw`, `diag motor pan|rising forward|reverse PERIOD STEPS`
  (pan 1–17, rising 1–30), `diag motor info`, spot/IR LED on/off/duty, status LEDs
* **PIN**: 6 digits in `/data/airiz/pin`. After every Bluetooth connection the client
  must send `auth <PIN>` before motor/LED commands run. Without it only
  `diag ver sw` and the motor stop are accepted. 5 wrong PINs lock it for 60 s.
* **Stop**: `stop` (or `diag motor stop`) writes `0` to
  `/sys/devices/platform/soc/soc:motor/status`; the motor driver stops the
  timer-driven move at once (verified: a 400-step pan stopped at step 184).
* **Who is connected** (v3): the bridge keeps `/tmp/airiz/clients`
  (`ADDRESS|LABEL|CONNECTED_EPOCH|PIN_OK` per line) and the controller address in
  `/tmp/airiz/self`. Clients send `hello <label>` (e.g. `hello iPhone (Bluefy)`) and can
  ask `who` → `#WHO#<controller>#ADDR|LABEL|SECONDS|PIN_OK;...#END#`. Both work without
  the PIN and only reveal device labels. `diag ver sw` adds `#BRIDGE#3#END#` so clients
  know these commands exist. The console's *Phone remote* dialog shows the list over USB.
* Installed in `/data/airiz` (persistent flash), so after a reboot only
  `sh /data/airiz/start.sh` is needed — the console's **Phone remote** button does
  this over USB. Runs until power-off (`start.sh SECONDS` for a time limit).

## Why it cannot start by itself after a reboot

The root filesystem is a read-only squashfs. The boot scripts (`/etc/init.d/rcS`,
`startZiris`) only read `/data/usbmode` as a value, root's home is the RAM disk
`/tmp`, and no boot step executes anything from `/data` or `/other`. Auto-start
needs a firmware change, e.g. one line at the end of `startZiris`:
`[ -f /data/airiz/start.sh ] && (sleep 20; sh /data/airiz/start.sh) > /tmp/airiz-boot.log 2>&1 &`
(`-f`, not `-x`: the installer does not make `start.sh` executable; the delay lets Bluetooth come up first).

## Use

* **Console (web or Windows app) over USB** → *Phone remote* → *Start remote* → PIN is shown.
* Or from a PC: `python start_bridge.py COM4` (installs/updates and starts; prints the PIN;
  `--new-pin` makes a new PIN).
* **iPhone**: install the free *Bluefy – Web BLE Browser*, open
  `https://juw12.github.io/projects/airiz-motor/`, *Connect Bluetooth*, choose AIRIZ-BT,
  enter the PIN. (Safari has no Web Bluetooth.)
* **Android**: AIRIZ Mobile app, or Chrome on the same website.

## Files

| File | Purpose |
| --- | --- |
| `bridge.sh` | GATT server loop, PIN check, allow-list, stop |
| `start.sh` | radio on, private bus, bluetoothd, starts the bridge, prints `#AIRIZBT#ready#PIN=…#END#` |
| `stop.sh` | stops the bridge (`#AIRIZBT#stopped#END#`) |
| `bus.conf` | permissive private D-Bus policy (system bus policy blocks GATT registration) |
| `start_bridge.py` | PC installer/launcher over the USB console |

After editing any of these, run `python ../tools/gen_bridge_files.py` so the web
console embeds the new version.
