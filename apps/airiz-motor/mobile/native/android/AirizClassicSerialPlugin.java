package io.github.juwpegatron.airiz.mobile;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.ParcelUuid;
import android.provider.Settings;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.InputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AirizClassicSerial", permissions = {
    @Permission(alias = "connect", strings = { Manifest.permission.BLUETOOTH_CONNECT })
})
public class AirizClassicSerialPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private final ExecutorService worker = Executors.newCachedThreadPool();
    private volatile BluetoothSocket socket;
    private volatile String deviceId;
    private volatile int generation = 0;

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private boolean permitted() {
        return Build.VERSION.SDK_INT < 31 || getPermissionState("connect") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void bondedDevices(PluginCall call) {
        if (!permitted()) {
            requestPermissionForAlias("connect", call, "listPermissionResult");
            return;
        }
        listBonded(call);
    }

    @PermissionCallback
    private void listPermissionResult(PluginCall call) {
        if (permitted()) listBonded(call);
        else call.reject("Bluetooth connection permission was denied.");
    }

    private void listBonded(PluginCall call) {
        try {
            BluetoothAdapter adapter = adapter();
            if (adapter == null) { call.reject("This phone has no Bluetooth adapter."); return; }
            if (!adapter.isEnabled()) { call.reject("Enable Bluetooth in Android settings first."); return; }
            JSArray devices = new JSArray();
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                JSObject item = new JSObject();
                item.put("deviceId", device.getAddress());
                item.put("name", device.getName());
                JSArray services = new JSArray();
                ParcelUuid[] uuids = device.getUuids();
                if (uuids != null) for (ParcelUuid uuid : uuids) services.put(uuid.toString());
                item.put("uuids", services);
                devices.put(item);
            }
            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!permitted()) {
            requestPermissionForAlias("connect", call, "connectPermissionResult");
            return;
        }
        connectPaired(call);
    }

    @PermissionCallback
    private void connectPermissionResult(PluginCall call) {
        if (permitted()) connectPaired(call);
        else call.reject("Bluetooth connection permission was denied.");
    }

    private void connectPaired(PluginCall call) {
        String address = call.getString("deviceId");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("Invalid Bluetooth device identifier.");
            return;
        }
        closeSocket();
        final int request = generation;
        worker.execute(() -> {
            try {
                BluetoothAdapter adapter = adapter();
                if (adapter == null || !adapter.isEnabled()) throw new IllegalStateException("Enable phone Bluetooth first.");
                BluetoothDevice device = adapter.getRemoteDevice(address);
                if (device.getBondState() != BluetoothDevice.BOND_BONDED) throw new IllegalStateException("Pair this device in Android Bluetooth settings before using Classic serial.");
                if (Build.VERSION.SDK_INT < 31 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) adapter.cancelDiscovery();
                BluetoothSocket candidate = device.createRfcommSocketToServiceRecord(SPP);
                synchronized (this) {
                    if (request != generation) { candidate.close(); call.reject("Connection cancelled."); return; }
                    socket = candidate;
                    deviceId = address;
                }
                getActivity().runOnUiThread(() -> bridge.getWebView().postDelayed(() -> {
                    if (request == generation && socket == candidate && !candidate.isConnected()) closeSocket();
                }, 12000));
                candidate.connect();
                if (request != generation) { candidate.close(); call.reject("Connection cancelled."); return; }
                JSObject connected = new JSObject();
                connected.put("deviceId", address);
                call.resolve(connected);
                worker.execute(() -> readLoop(candidate, address, request));
            } catch (Exception error) {
                if (request == generation) closeSocket();
                call.reject("Classic serial/SPP connection failed: " + error.getMessage(), error);
            }
        });
    }

    private void readLoop(BluetoothSocket connection, String address, int request) {
        try {
            InputStream input = connection.getInputStream();
            byte[] buffer = new byte[1024];
            while (request == generation && connection.isConnected()) {
                int count = input.read(buffer);
                if (count < 0) break;
                if (count == 0) continue;
                JSObject message = new JSObject();
                message.put("deviceId", address);
                message.put("value", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
                notifyListeners("data", message);
            }
        } catch (Exception ignored) {
            // Disconnect is reported below; it never causes an automatic reconnect.
        } finally {
            if (request == generation) {
                closeSocket();
                JSObject message = new JSObject();
                message.put("deviceId", address);
                message.put("message", "Classic serial connection closed.");
                notifyListeners("disconnected", message);
            }
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > 131072) { call.reject("Invalid serial payload."); return; }
        worker.execute(() -> {
            try {
                BluetoothSocket connection = socket;
                if (connection == null || !connection.isConnected()) throw new IllegalStateException("Classic serial is disconnected.");
                byte[] bytes = Base64.decode(value, Base64.DEFAULT);
                synchronized (connection) {
                    connection.getOutputStream().write(bytes);
                    connection.getOutputStream().flush();
                }
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeSocket();
        call.resolve();
    }

    private synchronized void closeSocket() {
        generation++;
        BluetoothSocket previous = socket;
        socket = null;
        deviceId = null;
        if (previous != null) try { previous.close(); } catch (Exception ignored) { }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @Override
    protected void handleOnDestroy() {
        closeSocket();
        worker.shutdownNow();
    }
}
