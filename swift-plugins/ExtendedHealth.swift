import Foundation
import Capacitor
import HealthKit

// Local Capacitor plugin for sleep querying.
// Add this file to your Xcode project's App target (ios/App/App/).
// No AppDelegate or registration changes are needed — Capacitor auto-discovers it.

@objc(ExtendedHealth)
public class ExtendedHealth: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "ExtendedHealth"
    public let jsName = "ExtendedHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "querySleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "querySleepQuality", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()
    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private let isoFormatterBasic: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        return f
    }()

    private func parseDate(_ str: String) -> Date? {
        return isoFormatter.date(from: str) ?? isoFormatterBasic.date(from: str)
    }

    // MARK: - querySleep
    // Returns { minutes: Int } — total minutes spent actually asleep in the window.
    @objc func querySleep(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["minutes": 0])
            return
        }
        let startStr = call.getString("startDate") ?? ""
        let endStr   = call.getString("endDate")   ?? ""
        guard let startDate = parseDate(startStr), let endDate = parseDate(endStr) else {
            call.resolve(["minutes": 0])
            return
        }
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            call.resolve(["minutes": 0])
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])
        let query = HKSampleQuery(
            sampleType: sleepType,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { _, samples, error in
            guard error == nil, let samples = samples as? [HKCategorySample] else {
                call.resolve(["minutes": 0])
                return
            }
            let asleepValues = Self.asleepCategoryValues()
            let inBedValue   = HKCategoryValueSleepAnalysis.inBed.rawValue
            let asleepSeconds = samples
                .filter { asleepValues.contains($0.value) }
                .reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
            // Fallback: iPhone-only tracking records only inBed samples (no separate asleep stages)
            if asleepSeconds > 0 {
                call.resolve(["minutes": Int(asleepSeconds / 60)])
            } else {
                let inBedSeconds = samples
                    .filter { $0.value == inBedValue }
                    .reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
                call.resolve(["minutes": Int(inBedSeconds / 60)])
            }
        }
        healthStore.execute(query)
    }

    // MARK: - querySleepQuality
    // Returns { efficiency: Int (0-100), minutes: Int }
    // efficiency = (time asleep / time in bed) × 100, falling back to duration proxy.
    @objc func querySleepQuality(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["efficiency": 0, "minutes": 0])
            return
        }
        let startStr = call.getString("startDate") ?? ""
        let endStr   = call.getString("endDate")   ?? ""
        guard let startDate = parseDate(startStr), let endDate = parseDate(endStr) else {
            call.resolve(["efficiency": 0, "minutes": 0])
            return
        }
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            call.resolve(["efficiency": 0, "minutes": 0])
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])
        let query = HKSampleQuery(
            sampleType: sleepType,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { _, samples, error in
            guard error == nil, let samples = samples as? [HKCategorySample] else {
                call.resolve(["efficiency": 0, "minutes": 0])
                return
            }

            let asleepValues = Self.asleepCategoryValues()
            let inBedValue   = HKCategoryValueSleepAnalysis.inBed.rawValue

            let asleepSeconds = samples
                .filter { asleepValues.contains($0.value) }
                .reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }

            let inBedSeconds = samples
                .filter { $0.value == inBedValue }
                .reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }

            let asleepMinutes = Int(asleepSeconds / 60)

            let efficiency: Int
            if inBedSeconds > 0 && asleepSeconds > 0 {
                // Standard sleep efficiency: time asleep ÷ time in bed
                efficiency = min(100, Int((asleepSeconds / inBedSeconds) * 100))
            } else if asleepSeconds > 0 {
                // No in-bed samples — proxy from duration: 8 h = 100 %
                efficiency = min(100, Int((asleepSeconds / (8.0 * 3600.0)) * 100))
            } else if inBedSeconds > 0 {
                // iPhone-only tracking: only inBed samples, no separate asleep stages.
                // Apply a standard 92 % efficiency assumption (WHO/AASM typical value).
                efficiency = min(100, Int((inBedSeconds / (8.0 * 3600.0)) * 92))
            } else {
                efficiency = 0
            }

            let reportMinutes = asleepMinutes > 0 ? asleepMinutes : Int(inBedSeconds / 60)
            call.resolve(["efficiency": efficiency, "minutes": reportMinutes])
        }
        healthStore.execute(query)
    }

    // MARK: - Helpers
    private static func asleepCategoryValues() -> Set<Int> {
        if #available(iOS 16.0, *) {
            return [
                HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                HKCategoryValueSleepAnalysis.asleepREM.rawValue,
            ]
        } else {
            return [HKCategoryValueSleepAnalysis.asleep.rawValue]
        }
    }
}
