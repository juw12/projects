// Vitals' own plugin: lets the dashboard check this iPhone (storage, memory, battery, heat, uptime).
// Read-only and permission-free. Appended to AppDelegate.swift by mobile/scripts/prepare-native.mjs,
// and Main.storyboard is pointed at VitalsViewController so the plugin is registered at launch.

class VitalsViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VitalsPhonePlugin())
        print("Vitals: VitalsPhone plugin registered (bridge \(bridge == nil ? "missing" : "ready"))")
    }
}

@objc(VitalsPhonePlugin)
public class VitalsPhonePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VitalsPhonePlugin"
    public let jsName = "VitalsPhone"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise)
    ]

    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(VitalsPhonePlugin.readings())
        }
    }

    static func modelIdentifier() -> String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulated
        }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
    }

    static func readings() -> [String: Any] {
        let device = UIDevice.current
        let process = ProcessInfo.processInfo
        var result: [String: Any] = [
            "platform": "iphone",
            "manufacturer": "Apple",
            "model": modelIdentifier(),
            "osVersion": device.systemVersion,
            "uptime": Int(process.systemUptime),
            "memoryTotal": Double(process.physicalMemory),
            "powerSave": process.isLowPowerModeEnabled
        ]

        switch process.thermalState {
        case .nominal:
            result["thermal"] = 0
        case .fair:
            result["thermal"] = 1
        case .serious:
            result["thermal"] = 3
        case .critical:
            result["thermal"] = 4
        @unknown default:
            break
        }

        device.isBatteryMonitoringEnabled = true
        if device.batteryLevel >= 0 {
            result["batteryPercent"] = Int((device.batteryLevel * 100).rounded())
            result["charging"] = device.batteryState == .charging || device.batteryState == .full
            result["pluggedIn"] = device.batteryState != .unplugged && device.batteryState != .unknown
        }

        let keys: Set<URLResourceKey> = [.volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey]
        if let values = try? URL(fileURLWithPath: NSHomeDirectory()).resourceValues(forKeys: keys) {
            if let total = values.volumeTotalCapacity {
                result["storageTotal"] = Double(total)
            }
            if let free = values.volumeAvailableCapacityForImportantUsage {
                result["storageFree"] = Double(free)
            }
        }
        return result
    }
}
