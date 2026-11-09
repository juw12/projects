/**
 * Preload script — exposes a minimal `window.buddy` API.
 * Most app logic runs in the renderer because the Supabase client
 * needs DOM access; the main process is just a shell.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';
import type { KeyboardEvent } from '../shared/types.js';

const api = {
  openSettings: (): void => {
    /* delegated to main process via IPC if needed */
  },

  onKey: (cb: (event: KeyboardEvent) => void): (() => void) => {
    const listener = (_evt: unknown, payload: KeyboardEvent) => cb(payload);
    ipcRenderer.on(IPC.KEYBOARD_EVENT, listener);
    return () => {
      ipcRenderer.removeListener(IPC.KEYBOARD_EVENT, listener);
    };
  },

  getProfile: (): Promise<string> => ipcRenderer.invoke(IPC.GET_PROFILE),
  setProfile: (id: string): Promise<string> => ipcRenderer.invoke(IPC.SET_PROFILE, id),
};

contextBridge.exposeInMainWorld('buddy', api);

export type BuddyAPI = typeof api;
