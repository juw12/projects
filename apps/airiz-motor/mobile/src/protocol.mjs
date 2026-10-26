// The Bluetooth protocol lives in the shared web console (web/ble-protocol.js) so the
// phone app, the website (Web Bluetooth / Bluefy on iPhone) and tests use one implementation.
import api from '../../web/ble-protocol.js';

export const {
  FIRMWARE_QUERY,
  SPP_UUID,
  normalizeUuid,
  discoverProfiles,
  customProfile,
  firmwareVersion,
  authReply,
  chunks,
  VerifiedSerialPort,
  pinStore,
  askPin
} = api;
