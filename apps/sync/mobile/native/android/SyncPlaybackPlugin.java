package io.github.juw12.sync;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge between the Sync web app and {@link SyncPlaybackService}.
 *
 * JS: Capacitor.nativePromise('SyncPlayback', 'update', {title, artist, room, playing, voice, positionMs, durationMs})
 *     Capacitor.nativePromise('SyncPlayback', 'stop', {})
 *     Capacitor.addListener('SyncPlayback', 'action', ({action, position}) => ...)
 *     Capacitor.nativePromise('SyncPlayback', 'status', {}) -> {running}
 */
@CapacitorPlugin(name = "SyncPlayback")
public class SyncPlaybackPlugin extends Plugin {
    private static SyncPlaybackPlugin instance;
    private boolean askedForNotifications = false;

    @Override
    public void load() {
        instance = this;
    }

    static void emit(String action, Double position) {
        SyncPlaybackPlugin plugin = instance;
        if (plugin == null) {
            return;
        }
        JSObject data = new JSObject();
        data.put("action", action);
        if (position != null) {
            data.put("position", position);
        }
        plugin.notifyListeners("action", data);
    }

    @PluginMethod
    public void update(PluginCall call) {
        askForNotificationsOnce();
        Context context = getContext();
        Intent intent = new Intent(context, SyncPlaybackService.class)
            .setAction(SyncPlaybackService.ACTION_UPDATE)
            .putExtra("title", call.getString("title", "Sync"))
            .putExtra("artist", call.getString("artist", "Listening together"))
            .putExtra("room", call.getString("room", ""))
            .putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)))
            .putExtra("voice", Boolean.TRUE.equals(call.getBoolean("voice", false)))
            .putExtra("positionMs", (long) call.getData().optDouble("positionMs", 0))
            .putExtra("durationMs", (long) call.getData().optDouble("durationMs", 0));
        try {
            if (!SyncPlaybackService.running && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            JSObject result = new JSObject();
            result.put("running", true);
            call.resolve(result);
        } catch (RuntimeException error) {
            // Android refuses to start a foreground service from the background; the next update from
            // the foreground starts it.
            call.reject("Could not start background playback: " + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), SyncPlaybackService.class));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", SyncPlaybackService.running);
        call.resolve(result);
    }

    private void askForNotificationsOnce() {
        if (askedForNotifications || Build.VERSION.SDK_INT < 33 || getActivity() == null) {
            return;
        }
        askedForNotifications = true;
        String permission = Manifest.permission.POST_NOTIFICATIONS;
        if (getContext().checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { permission }, 7302);
        }
    }
}
