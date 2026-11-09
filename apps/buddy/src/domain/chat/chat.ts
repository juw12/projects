/**
 * 1:1 chat with buddies. We always normalize (user_a_id < user_b_id) so
 * a single thread is uniquely identified by the ordered pair.
 * Auto-fires a 'message' clicky on send.
 */

import { supabase } from '@/db/local';
import { giveClicky } from '@/domain/clicky';
import type { ChatMessage, UUID } from '@shared/types';

function threadKey(a: UUID, b: UUID): [UUID, UUID] {
  return a < b ? [a, b] : [b, a];
}

export async function sendMessage(
  toUserId: UUID,
  body: string,
): Promise<ChatMessage> {
  const me = (await supabase.auth.getUser()) as { data: { user: { id: string } } };
  const userId = me.data.user.id;
  const [userAId, userBId] = threadKey(userId, toUserId);
  const result = await supabase
    .from('messages')
    .insert({
      user_a_id: userAId,
      user_b_id: userBId,
      sender_id: userId,
      body,
      meta: null,
    })
    .select();
  const data = result.data[0];
  if (!data) throw new Error('Failed to insert message');

  void giveClicky(toUserId, 'message').catch((err) => {
    console.warn('[chat] auto-clicky failed:', err);
  });

  return data as ChatMessage;
}

export async function listMessages(
  otherUserId: UUID,
  limit = 50,
  before?: string,
): Promise<ChatMessage[]> {
  const me = (await supabase.auth.getUser()) as { data: { user: { id: string } } };
  const userId = me.data.user.id;
  const [userAId, userBId] = threadKey(userId, otherUserId);

  if (before) {
    const r = await supabase
      .from('messages')
      .eq('user_a_id', userAId)
      .eq('user_b_id', userBId)
      .lt('created_at', before)
      .order('created_at', { ascending: false })
      .limit(limit)
      .select();
    if (r.error) throw new Error(r.error.message);
    return ((r.data ?? []) as ChatMessage[]).reverse();
  }

  const r = await supabase
    .from('messages')
    .eq('user_a_id', userAId)
    .eq('user_b_id', userBId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .select();
  if (r.error) throw new Error(r.error.message);
  return ((r.data ?? []) as ChatMessage[]).reverse();
}
