import { supabase } from '@/db/local';
import type { FriendEdge, UserProfile, UUID } from '@shared/types';

function generateInviteCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

async function getUserId(): Promise<string> {
  const me = (await supabase.auth.getUser()) as { data: { user: { id: string } } };
  return me.data.user.id;
}

export async function listFriends(): Promise<FriendEdge[]> {
  const userId = await getUserId();
  const result = await supabase
    .from('friends')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
    .eq('status', 'accepted')
    .select();
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as unknown as FriendEdge[];
}

export async function listPendingInvites(): Promise<FriendEdge[]> {
  const userId = await getUserId();
  const result = await supabase
    .from('friends')
    .eq('friend_id', userId)
    .eq('status', 'pending')
    .select();
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as unknown as FriendEdge[];
}

export async function createInvite(targetUserId: UUID): Promise<string> {
  const userId = await getUserId();
  const code = generateInviteCode();
  const result = await supabase.from('friends').insert({
    user_id: userId,
    friend_id: targetUserId,
    status: 'pending',
    invite_code: code,
  }).select();
  if (result.error) throw new Error(result.error.message);
  return code;
}

export async function acceptInvite(inviteCode: string): Promise<void> {
  const userId = await getUserId();
  const result = await supabase
    .from('friends')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('invite_code', inviteCode)
    .eq('friend_id', userId)
    .select();
  if (result.error) throw new Error(result.error.message);
}

export async function removeFriend(otherUserId: UUID): Promise<void> {
  const userId = await getUserId();
  const result = await supabase
    .from('friends')
    .delete()
    .or(`and(user_id.eq.${userId},friend_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},friend_id.eq.${userId})`)
    .select();
  if (result.error) throw new Error(result.error.message);
}

export async function lookupUserByInviteCode(code: string): Promise<UserProfile | null> {
  const result = await supabase
    .from('profiles')
    .or(`id.eq.${code},display_name.ilike.${code}`)
    .select();
  if (result.error) throw new Error(result.error.message);
  return ((result.data ?? [])[0] ?? null) as UserProfile | null;
}
