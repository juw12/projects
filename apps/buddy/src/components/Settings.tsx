/**
 * Settings panel: theme picker, profile.
 */

import { useEffect } from 'react';
import { useBuddyStore } from '@/state/store';
import { THEMES, applyTheme } from '@/themes';
import { supabase } from '@/db/local';

export function Settings(): JSX.Element {
  const themeId = useBuddyStore((s) => s.themeId);
  const setTheme = useBuddyStore((s) => s.setTheme);
  const profile = useBuddyStore((s) => s.profile);

  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);

  async function persistTheme(id: 'minimal' | 'neon' | 'synthwave'): Promise<void> {
    setTheme(id);
    if (profile) {
      await supabase.from('profiles').eq('id', profile.id).update({ active_theme: id });
    }
  }

  return (
    <div className="settings-panel">
      <h2>Settings</h2>
      {profile && (
        <section className="settings-section">
          <div className="profile-row">
            <div className="profile-avatar">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{profile.display_name.slice(0, 2).toUpperCase()}</span>}
            </div>
            <div>
              <div className="profile-name">{profile.display_name}</div>
              <div className="profile-streak">{profile.current_streak_days}d streak</div>
            </div>
          </div>
        </section>
      )}
      <section className="settings-section">
        <label className="settings-label">Theme</label>
        <div className="theme-grid">
          {(['minimal', 'neon', 'synthwave'] as const).map((id) => (
            <button
              key={id}
              className={`theme-card ${themeId === id ? 'is-active' : ''}`}
              onClick={() => void persistTheme(id)}
            >
              {THEMES[id].name}
            </button>
          ))}
        </div>
        <p className="settings-hint">Buddy is local-only — your data lives on this machine.</p>
      </section>
    </div>
  );
}
