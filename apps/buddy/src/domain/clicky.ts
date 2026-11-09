/**
 * Clicky counter mechanic. The atomic increment + event insert is handled
 * by supabase.rpc('give_clicky', ...) which is implemented in db/local.ts.
 */

import { supabase } from '@/db/local';

export type ClickySource = 'manual' | 'message' | 'focus_complete';

export async function giveClicky(toUserId: string, source: ClickySource = 'manual'): Promise<void> {
  const { error } = await supabase.rpc('give_clicky', {
    p_to_user_id: toUserId,
    p_source: source,
  });
  if (error) throw new Error(error.message);
}

export async function giveManualClicky(toUserId: string): Promise<void> {
  return giveClicky(toUserId, 'manual');
}
