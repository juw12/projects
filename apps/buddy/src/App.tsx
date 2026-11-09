/**
 * Root App component. Seeds local data on first launch, applies the theme,
 * and subscribes to system-wide keyboard events from the Electron main
 * process for the audio + particle feedback.
 */

import { useEffect } from 'react';
import { useBuddyStore } from '@/state/store';
import { MainView } from './components/MainView';
import { applyTheme } from '@/themes';
import { audioEngine } from '@/audio/engine';
import { getProfile } from '@/audio/profiles';
import { supabase, getCurrentUser, onChange } from '@/db/local';
import { seedIfEmpty } from '@/db/seed';
import type { KeyboardEvent, UserProfile } from '@shared/types';

declare global {
  interface Window {
    buddy?: {
      openSettings: () => void;
      onKey: (cb: (event: KeyboardEvent) => void) => () => void;
      getProfile: () => Promise<string>;
      setProfile: (id: string) => Promise<string>;
    };
  }
}

export function App(): JSX.Element {
  const ready = useBuddyStore((s) => s.ready);
  const setReady = useBuddyStore((s) => s.setReady);
  const setProfile = useBuddyStore((s) => s.setProfile);
  const themeId = useBuddyStore((s) => s.themeId);
  const setRecent = useBuddyStore((s) => s.setRecent);
  const activeProfileId = useBuddyStore((s) => s.profile?.active_switch_profile ?? 'cherry-blue');

  useEffect(() => {
    void (async () => {
      await seedIfEmpty();
      const me = getCurrentUser();
      const { data: persisted } = await supabase.from('profiles').eq('id', me.id).maybeSingle();
      setProfile((persisted ?? me) as UserProfile);
      setReady(true);
    })();
  }, [setProfile, setReady]);

  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);

  useEffect(() => {
    audioEngine.ensure();
    void audioEngine.resume();
  }, []);

  useEffect(() => {
    const api = window.buddy;
    if (!api || !api.onKey) return;
    const profile = getProfile(activeProfileId);
    const unsub = api.onKey((event) => {
      const arrival = performance.now();
      audioEngine.trigger(profile, arrival, event.type === 'up');
      setRecent({ ...event, arrivalMs: arrival });
    });
    return unsub;
  }, [activeProfileId, setRecent]);

  useEffect(() => {
    const unsub = onChange(({ store, row }) => {
      const state = useBuddyStore.getState();
      if (store === 'profiles' && (row as { id: string }).id === state.profile?.id) {
        useBuddyStore.setState({ profile: row as unknown as UserProfile });
      }
    });
    return unsub;
  }, []);

  if (!ready) {
    return <div className="loading">Loading…</div>;
  }
  return <MainView />;
}
