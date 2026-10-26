package io.github.juw12.sync;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

/**
 * Keeps Sync alive while you are in a room with the app in the background or the screen off
 * (Android 14+ freezes background apps that have no foreground service), and shows a media
 * notification + lock-screen player whose buttons control the room.
 */
public class SyncPlaybackService extends Service {
    static final String CHANNEL_ID = "sync_playback";
    static final int NOTIFICATION_ID = 7301;
    static final String ACTION_UPDATE = "io.github.juw12.sync.UPDATE";
    static final String ACTION_BUTTON = "io.github.juw12.sync.BUTTON";

    static volatile boolean running = false;

    private MediaSession session;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        session = new MediaSession(this, "Sync");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                SyncPlaybackPlugin.emit("play", null);
            }

            @Override
            public void onPause() {
                SyncPlaybackPlugin.emit("pause", null);
            }

            @Override
            public void onSkipToNext() {
                SyncPlaybackPlugin.emit("next", null);
            }

            @Override
            public void onSkipToPrevious() {
                SyncPlaybackPlugin.emit("prev", null);
            }

            @Override
            public void onSeekTo(long positionMs) {
                SyncPlaybackPlugin.emit("seek", positionMs / 1000.0);
            }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_BUTTON.equals(intent.getAction())) {
            String button = intent.getStringExtra("button");
            if (button != null) {
                SyncPlaybackPlugin.emit(button, null);
            }
            return START_NOT_STICKY;
        }

        String title = extra(intent, "title", "Sync");
        String artist = extra(intent, "artist", "Listening together");
        String room = extra(intent, "room", "");
        boolean playing = intent != null && intent.getBooleanExtra("playing", false);
        boolean voice = intent != null && intent.getBooleanExtra("voice", false);
        long positionMs = intent != null ? intent.getLongExtra("positionMs", 0) : 0;
        long durationMs = intent != null ? intent.getLongExtra("durationMs", 0) : 0;

        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, room)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                positionMs, playing ? 1f : 0f, SystemClock.elapsedRealtime())
            .build());

        Notification notification = buildNotification(title, artist, room, playing);
        startForegroundWithType(notification, voice);
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The app (and its WebView playing the music) was swiped away: nothing left to keep alive.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    private static String extra(Intent intent, String key, String fallback) {
        String value = intent != null ? intent.getStringExtra(key) : null;
        return value == null || value.isEmpty() ? fallback : value;
    }

    private void startForegroundWithType(Notification notification, boolean voice) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification);
            return;
        }
        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        boolean micAllowed = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (voice && micAllowed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE; // keep voice chat open in the background
        }
        try {
            startForeground(NOTIFICATION_ID, notification, type);
        } catch (RuntimeException error) {
            // e.g. adding the microphone type while in the background is not allowed: keep the music alive.
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        }
    }

    private Notification buildNotification(String title, String artist, String room, boolean playing) {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Listening together", NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("Shows the room you are listening in and its playback controls.");
                channel.setShowBadge(false);
                manager.createNotificationChannel(channel);
            }
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openApp = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        builder.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(room)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", "prev", 1))
            .addAction(playing
                ? action(android.R.drawable.ic_media_pause, "Pause", "pause", 2)
                : action(android.R.drawable.ic_media_play, "Play", "play", 3))
            .addAction(action(android.R.drawable.ic_media_next, "Next", "next", 4))
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return builder.build();
    }

    private Notification.Action action(int icon, String label, String button, int requestCode) {
        Intent intent = new Intent(this, SyncPlaybackService.class)
            .setAction(ACTION_BUTTON)
            .putExtra("button", button);
        PendingIntent pending = PendingIntent.getService(this, requestCode, intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, pending).build();
    }
}
