/**
 * IPC channel names for Electron main <-> renderer communication.
 * The renderer never imports from electron; it only uses the `window.buddy`
 * API exposed by preload.ts.
 */

export const IPC = {
  GET_SESSION: 'buddy:get-session',
  ON_AUTH_CHANGE: 'buddy:on-auth-change',
  OPEN_SETTINGS: 'buddy:open-settings',
  AUTH_CHANGED: 'buddy:auth-changed',
  KEYBOARD_EVENT: 'buddy:keyboard-event',
  GET_PROFILE: 'buddy:get-profile',
  SET_PROFILE: 'buddy:set-profile',
} as const;
