package io.github.juw12.vitals;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.PowerManager;
import android.os.StatFs;
import android.os.SystemClock;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reads this phone's own health for the Vitals dashboard: storage, memory, battery, heat and uptime.
 * Read-only and permission-free; every reading is optional so one failing API never hides the rest.
 * Copied into the Android project by mobile/scripts/prepare-native.mjs.
 */
@CapacitorPlugin(name = "VitalsPhone")
public class VitalsPhonePlugin extends Plugin {

    @PluginMethod
    public void snapshot(PluginCall call) {
        Context context = getContext();
        JSObject out = new JSObject();
        try {
            out.put("platform", "android");
            out.put("manufacturer", Build.MANUFACTURER);
            out.put("model", Build.MODEL);
            out.put("osVersion", Build.VERSION.RELEASE);
            out.put("sdk", Build.VERSION.SDK_INT);
            out.put("uptime", SystemClock.elapsedRealtime() / 1000L);
        } catch (Exception ignored) {
            // keep going with whatever else we can read
        }

        try {
            StatFs stat = new StatFs(Environment.getDataDirectory().getPath());
            out.put("storageTotal", stat.getTotalBytes());
            out.put("storageFree", stat.getAvailableBytes());
        } catch (Exception ignored) {
            // storage unavailable
        }

        try {
            ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
            manager.getMemoryInfo(memory);
            out.put("memoryTotal", memory.totalMem);
            out.put("memoryAvailable", memory.availMem);
            out.put("lowMemory", memory.lowMemory);
        } catch (Exception ignored) {
            // memory unavailable
        }

        try {
            // ACTION_BATTERY_CHANGED is sticky: registering with no receiver just returns the last value.
            Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (battery != null) {
                int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0) {
                    out.put("batteryPercent", Math.round(100f * level / scale));
                }
                int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                out.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
                out.put("pluggedIn", battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0);
                out.put("batteryHealth", healthName(battery.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)));
                int tenths = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
                if (tenths != Integer.MIN_VALUE && tenths > -400) {
                    out.put("batteryTemperature", tenths / 10.0);
                }
                int cycles = battery.getIntExtra("android.os.extra.CYCLE_COUNT", -1);
                if (cycles >= 0) {
                    out.put("batteryCycles", cycles);
                }
            }
        } catch (Exception ignored) {
            // battery unavailable
        }

        try {
            PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            out.put("powerSave", power.isPowerSaveMode());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                out.put("thermal", power.getCurrentThermalStatus());
            }
        } catch (Exception ignored) {
            // power state unavailable
        }

        call.resolve(out);
    }

    private static String healthName(int health) {
        switch (health) {
            case BatteryManager.BATTERY_HEALTH_GOOD:
                return "good";
            case BatteryManager.BATTERY_HEALTH_OVERHEAT:
                return "overheat";
            case BatteryManager.BATTERY_HEALTH_DEAD:
                return "dead";
            case BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE:
                return "over_voltage";
            case BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE:
                return "failure";
            case BatteryManager.BATTERY_HEALTH_COLD:
                return "cold";
            default:
                return "unknown";
        }
    }
}
