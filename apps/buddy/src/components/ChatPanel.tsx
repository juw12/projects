/**
 * Chat panel — 1:1 messages with the selected buddy.
 * Loads history on open, subscribes to new messages via Realtime.
 */

import { useEffect, useRef, useState } from 'react';
import { useBuddyStore } from '@/state/store';
import { listMessages, sendMessage } from '@/domain/chat/chat';
import { subscribeToChat } from '@/realtime/subscriptions';
import { audioEngine } from '@/audio/engine';
import { getProfile } from '@/audio/profiles';

export function ChatPanel(): JSX.Element {
  const activeBuddyId = useBuddyStore((s) => s.chat.activeBuddyId);
  const messagesByBuddy = useBuddyStore((s) => s.chat.messagesByBuddy);
  const setMessages = useBuddyStore((s) => s.setMessages);
  const appendMessage = useBuddyStore((s) => s.appendMessage);
  const closeChat = useBuddyStore((s) => s.closeChat);
  const themeId = useBuddyStore((s) => s.themeId);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeBuddyId) return;
    void listMessages(activeBuddyId, 50).then((msgs) => setMessages(activeBuddyId, msgs));
    const unsub = subscribeToChat(activeBuddyId, (msg) => appendMessage(activeBuddyId, msg));
    return unsub;
  }, [activeBuddyId, appendMessage, setMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesByBuddy, activeBuddyId]);

  if (!activeBuddyId) {
    return (
      <div className="chat-panel empty">
        <p className="muted">Pick a buddy to start chatting.</p>
      </div>
    );
  }

  const messages = messagesByBuddy[activeBuddyId] ?? [];
  const recipientId: string = activeBuddyId;
  const profile = getProfile('cherry-blue');

  async function onSend(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const msg = await sendMessage(recipientId, text.trim());
      appendMessage(recipientId, msg);
      audioEngine.trigger(profile, performance.now(), false);
      setText('');
    } catch (err) {
      console.error('[chat] send failed:', err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-panel" data-theme={themeId}>
      <div className="chat-header">
        <span>Chat</span>
        <button className="close" onClick={closeChat}>×</button>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && <p className="muted center">No messages yet. Say hi.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.sender_id === activeBuddyId ? 'them' : 'me'}`}>
            <div className="chat-msg-body">{m.body}</div>
            <div className="chat-msg-time">
              {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
      </div>

      <form className="chat-input" onSubmit={onSend}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          maxLength={4000}
        />
        <button type="submit" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
