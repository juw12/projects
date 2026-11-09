/**
 * Main view after login: 3-column layout.
 * - Left: my focus timer
 * - Center: buddy list
 * - Right: chat with selected buddy (slides in)
 */

import { useEffect, useState } from 'react';
import { useBuddyStore } from '@/state/store';
import { FocusTimer } from './FocusTimer';
import { BuddyList } from './BuddyList';
import { ChatPanel } from './ChatPanel';
import { Settings } from './Settings';
import { ParticleCanvas } from './ParticleCanvas';
import { audioEngine } from '@/audio/engine';
import { getProfile } from '@/audio/profiles';
import { applyTheme } from '@/themes';
import { getWeeklyLeaderboard } from '@/domain/leaderboard';

export function MainView(): JSX.Element {
  const [showSettings, setShowSettings] = useState(false);
  const themeId = useBuddyStore((s) => s.themeId);
  const setLeaderboard = useBuddyStore((s) => s.setLeaderboard);
  const leaderboard = useBuddyStore((s) => s.leaderboard);

  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);

  useEffect(() => {
    void getWeeklyLeaderboard(true).then(setLeaderboard).catch(console.error);
  }, [setLeaderboard]);

  useEffect(() => {
    audioEngine.ensure();
    void audioEngine.resume();
    audioEngine.trigger(getProfile('cherry-blue'), performance.now(), false);
  }, []);

  return (
    <div className="main-view" data-theme={themeId}>
      <ParticleCanvas />
      <header className="top-bar">
        <div className="brand">Buddy</div>
        <button className="settings-toggle" onClick={() => setShowSettings((s) => !s)}>⚙</button>
      </header>

      <div className="grid">
        <section className="col focus-col">
          <h3>You</h3>
          <FocusTimer />
        </section>

        <section className="col buddies-col">
          <h3>Buddies</h3>
          <BuddyList />
          <h3 className="mt">Leaderboard</h3>
          <ol className="leaderboard">
            {leaderboard.map((entry, i) => (
              <li key={entry.user_id}>
                <span className="rank">{i + 1}</span>
                <span className="name">{entry.display_name}</span>
                <span className="hours">
                  {Math.round(entry.week_focus_seconds / 60)} min
                </span>
                <span className="clicky" title="Clickies received">
                  ● {entry.clicky_received_count ?? 0}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="col chat-col">
          <ChatPanel />
        </section>
      </div>

      {showSettings && (
        <div className="settings-overlay">
          <Settings />
        </div>
      )}
    </div>
  );
}
