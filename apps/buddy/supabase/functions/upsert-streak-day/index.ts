// supabase/functions/upsert-streak-day/index.ts
// Deploy with: supabase functions deploy upsert-streak-day
//
// Called from src/domain/focus/focus.ts via supabase.rpc(). Increments
// the streak day counter, recomputes current_streak_days / longest_streak_days,
// and updates total_focus_seconds on the profile row.

import { createClient } from 'npm:@supabase/supabase-js@2.46.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface Args {
  p_user_id: string;
  p_day: string;
  p_seconds: number;
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { p_user_id, p_day, p_seconds } = await req.json() as Args;

  // Upsert the streak_days row.
  await supabase.from('streak_days').upsert({
    user_id: p_user_id,
    day: p_day,
    completed: true,
    focus_seconds: p_seconds,
  });

  // Recompute streak: walk backward from today and count consecutive completed days.
  const { data: recent } = await supabase
    .from('streak_days')
    .select('day, completed')
    .eq('user_id', p_user_id)
    .order('day', { ascending: false })
    .limit(60);

  let current = 0;
  if (recent) {
    let dayCursor = new Date();
    for (const row of recent as Array<{ day: string; completed: boolean }>) {
      const dayStr = dayCursor.toISOString().slice(0, 10);
      if (row.day === dayStr && row.completed) {
        current++;
        dayCursor.setDate(dayCursor.getDate() - 1);
      } else {
        break;
      }
    }
  }

  // Get the longest streak to compare.
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_streak_days, longest_streak_days, total_focus_seconds')
    .eq('id', p_user_id)
    .single();

  const longest = Math.max((profile?.longest_streak_days ?? 0), current);

  await supabase.from('profiles').update({
    current_streak_days: current,
    longest_streak_days: longest,
    last_streak_date: p_day,
    total_focus_seconds: (profile?.total_focus_seconds ?? 0) + p_seconds,
  }).eq('id', p_user_id);

  return new Response(JSON.stringify({ current, longest }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
