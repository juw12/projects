// supabase/functions/push-buddy-event/index.ts
// Deploy with: supabase functions deploy push-buddy-event
//
// Triggered by Postgres webhooks (in production you'd configure these in
// Supabase Studio on the focus_events table). Sends a Web Push to the
// buddy who owns the recipient's push_subscriptions rows.

import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;

webpush.setVapidDetails('mailto:hello@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

interface FocusEventRow {
  id: number;
  user_id: string;
  kind: 'start' | 'complete' | 'abort';
  session_id: string | null;
  planned_seconds: number | null;
  note: string | null;
  created_at: string;
}

interface BuddyRow {
  user_id: string;
  friend_id: string;
}

interface PushSubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json() as { record: FocusEventRow };
    const event = payload.record;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: friendRows } = await supabase
      .from('friends')
      .select('user_id, friend_id')
      .eq('status', 'accepted')
      .or(`user_id.eq.${event.user_id},friend_id.eq.${event.user_id}`);

    const buddyIds = ((friendRows ?? []) as BuddyRow[])
      .map((r) => (r.user_id === event.user_id ? r.friend_id : r.user_id))
      .filter((id, i, arr) => arr.indexOf(id) === i);

    if (buddyIds.length === 0) return new Response('no buddies', { status: 200 });

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', buddyIds);

    if (!subs || subs.length === 0) return new Response('no subscriptions', { status: 200 });

    const title = event.kind === 'start' ? 'Your buddy started focusing' :
                  event.kind === 'complete' ? 'Your buddy finished a focus block' :
                  'Your buddy paused';

    const results = await Promise.allSettled((subs as PushSubRow[]).map((s) =>
      webpush.sendNotification(
        s.endpoint,
        JSON.stringify({
          title,
          body: event.note ?? `${Math.round((event.planned_seconds ?? 0) / 60)} min session`,
          icon: '/icon-192.png',
          data: { kind: event.kind, session_id: event.session_id },
        }),
        { keys: { p256dh: s.p256dh, auth: s.auth } },
      ),
    ));

    return new Response(JSON.stringify({ sent: results.filter((r) => r.status === 'fulfilled').length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});
