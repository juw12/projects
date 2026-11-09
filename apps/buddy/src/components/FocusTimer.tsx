/**
 * Focus timer — Pomodoro controls. Start a session, see the countdown,
 * complete or abort. Broadcasts events via the focus domain module.
 */

import { useEffect, useState } from 'react';
import { useBuddyStore } from '@/state/store';
import { startFocusSession, completeFocusSession, abortFocusSession } from '@/domain/focus/focus';
import { audioEngine } from '@/audio/engine';
import { getProfile } from '@/audio/profiles';
import type { FocusSession } from '@shared/types';

const POMODORO_SECONDS = 25 * 60;

export function FocusTimer(): JSX.Element {
  const active = useBuddyStore((s) => s.activeFocus);
  const setActive = useBuddyStore((s) => s.setActiveFocus);
  const themeId = useBuddyStore((s) => s.themeId);
  const [note, setNote] = useState('');
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!active) {
      setRemaining(0);
      return;
    }
    const startMs = Date.parse(active.started_at);
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const left = Math.max(0, active.planned_seconds - elapsed);
      setRemaining(left);
      if (left === 0 && active.state === 'active') {
        void handleComplete(active, active.planned_seconds);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  async function handleStart(): Promise<void> {
    try {
      const session = await startFocusSession(POMODORO_SECONDS, note || undefined);
      setActive(session);
      audioEngine.trigger(getProfile('cherry-blue'), performance.now(), false);
    } catch (err) {
      console.error('[focus] start failed:', err);
    }
  }

  async function handleComplete(session: FocusSession, actual: number): Promise<void> {
    try {
      await completeFocusSession(session.id, actual);
      setActive(null);
      audioEngine.trigger(getProfile('cherry-blue'), performance.now(), false);
    } catch (err) {
      console.error('[focus] complete failed:', err);
    }
  }

  async function handleAbort(): Promise<void> {
    if (!active) return;
    try {
      await abortFocusSession(active.id);
      setActive(null);
    } catch (err) {
      console.error('[focus] abort failed:', err);
    }
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div className="focus-timer" data-theme={themeId}>
      {active ? (
        <>
          <div className="timer-display">{mm}:{ss}</div>
          <div className="timer-note">{active.note ?? 'Focus session'}</div>
          <div className="timer-controls">
            <button onClick={handleAbort}>Abort</button>
          </div>
        </>
      ) : (
        <>
          <div className="timer-display idle">--:--</div>
          <input
            type="text"
            placeholder="What are you focusing on?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={120}
          />
          <button className="start" onClick={handleStart}>Start 25:00 focus</button>
        </>
      )}
    </div>
  );
}
