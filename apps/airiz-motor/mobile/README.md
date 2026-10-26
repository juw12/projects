# AIRIZ Mobile — Bluetooth preview

Native Android and iPhone projects bundle the shared AIRIZ console locally.
This is not a website shortcut. Android uses native BLE and a paired Classic
serial/SPP plugin. iPhone uses native CoreBluetooth/BLE; generic Classic SPP is
not presented as an iPhone feature.

## What the app can establish without a Bluetooth specification

1. Scan advertisements on demand and let the operator select the device.
2. Discover its actual GATT services, characteristics and properties.
3. Recognize Nordic UART or HM-10-style UART profiles when genuinely present.
4. On Android, optionally connect to the standard serial/SPP service of a device
   that the operator has already paired in Android settings.
5. Send the existing firmware-version query `diag ver sw` and wait for a framed
   version reply matching the documented `#INFO#...#END#` protocol.
6. Enable the normal finite jogs, console and macros only after that command
   channel check passes. Connecting or scanning never sends a jog command.

Unknown vendor-specific profiles can be inspected/exported. An advanced mapping
requires an explicit choice and opt-in before sending the text protocol query.
Standard GATT services and known DFU service mappings are not offered as custom
motor consoles. A generic success code, device name or Bluetooth connection alone
never unlocks motor control. The check verifies protocol behavior, not a device's
cryptographic identity.

## Start with the one command already known

Use the existing USB/Windows console to send `diag ble on` first if the device
radio is off. Then open this app and select **Connect Bluetooth → Scan devices**.
Choose your own AIRIZ device, not an unrelated nearby peripheral.

Powering on a Bluetooth controller does not necessarily make it advertise a
command service. If the device exposes no UART/control service, the app reports
that limitation and can export the discovered profile. A phone app cannot create
that missing firmware service remotely. No device-side daemon, firmware change or
undocumented motor opcode is silently installed or guessed.

For Android Classic serial, first pair in the phone's system Bluetooth settings.
The app uses the authenticated RFCOMM/SPP socket API and does not bypass pairing.
For BLE, the peripheral must enforce pairing/encryption if its use requires it.
Use this preview only with a trusted device and a safe bench setup.

## Native packages

- Android: signed APK with a stable, private project signing identity. Android 8+
  and an up-to-date system WebView are the intended baseline. It is not a Play Store
  listing; installing the APK uses the normal Android installation permissions.
- iPhone: device-targeted **unsigned IPA** and an Xcode project build. iOS 16+
  is targeted. The unsigned IPA is **not installable on a stock iPhone as-is**.
  Apple development/ad-hoc signing or TestFlight/App Store distribution still needs
  the operator's legitimate Apple signing/provisioning. No Apple account or signing
  certificate is fabricated, and simulator compilation is not Bluetooth hardware
  validation.

The workflow builds Android on Linux and iOS on macOS with the platform SDKs.
The iPhone simulator is used only to inspect app launch/rendering; a simulator is
not a substitute for physical BLE tests. Physical AIRIZ Bluetooth interoperability
has not been established until a real device passes the app's command-channel check.

## Behavior and limitations

- Local commands/macros/preferences are separate from browser and Windows profiles.
- Disconnecting a verified Bluetooth link disables control; reconnecting verifies it
  again. Normal focus or tab changes do not reset the enabled jog preference.
- Keep motor tests in the foreground. Mobile OS suspension can delay JavaScript
  macro timing. No background control reliability is claimed.
- No hardware stop or home command was documented. Closing, locking or disconnecting
  does not stop an already-issued finite movement.
- The Camera tab is explicitly a **phone camera preview**, not device video over
  Bluetooth. Large WAV/recording transfers and firmware work should use USB/Windows.
- Recording auto-pull defaults off on mobile. Exports use the phone's native share
  sheet and a 20 MB preview limit. Review logs before sharing; commands can contain
  credentials. Only the selected device's services/replies enter a diagnostic export.
- Bluetooth discovery is on demand, scanning stops after 15 seconds or when the app
  backgrounds, and discovery data is not uploaded to a server automatically.

## Building

Use Node 24. Install pinned dependencies, run the protocol tests and bundle the UI.
Generate Android/iOS projects with the corresponding preparation script. The native
platform directories are generated output; edit the tracked source/templates instead.
Android release builds require the encrypted CI signing identity, not a new debug
key on each build. iOS compilation intentionally disables code signing until a real
Apple identity/provisioning profile is supplied.

```sh
npm ci
npm test
npm run build
npm run android:prepare
npm run ios:prepare
```

The Xcode project package needs its npm dependencies restored and the shared UI
built before opening/building it. It does not include any private signing key.
