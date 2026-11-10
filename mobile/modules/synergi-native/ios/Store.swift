import Foundation

// What the phone keeps between launches: where the server is, the phone's own key (to decline a call or ask about a
// ringing one without a sign-in cookie), its two push addresses, and the calls that already ended here.
enum Store {
  private static let defaults = UserDefaults(suiteName: "synergi_native") ?? .standard

  static var origin: String? {
    get { defaults.string(forKey: "origin") }
    set { defaults.set(newValue, forKey: "origin") }
  }

  static var deviceKey: String? {
    get { defaults.string(forKey: "deviceKey") }
    set { defaults.set(newValue, forKey: "deviceKey") }
  }

  // The call address (PushKit), which is also the phone's name on the server.
  static var voipToken: String? {
    get { defaults.string(forKey: "voipToken") }
    set { defaults.set(newValue, forKey: "voipToken") }
  }

  // The notification address (messages, missed calls).
  static var alertToken: String? {
    get { defaults.string(forKey: "alertToken") }
    set { defaults.set(newValue, forKey: "alertToken") }
  }

  // A ring that ended here never rings again from a late push. Forgotten after a day.
  static func markEnded(_ callId: String, _ ringStartedAt: Int64) {
    let now = Date().timeIntervalSince1970
    var ended = (defaults.dictionary(forKey: "ended") as? [String: Double] ?? [:]).filter { now - $0.value < 86_400 }
    ended["\(callId):\(ringStartedAt)"] = now
    defaults.set(ended, forKey: "ended")
  }

  static func endedHere(_ callId: String, _ ringStartedAt: Int64) -> Bool {
    (defaults.dictionary(forKey: "ended") as? [String: Double])?["\(callId):\(ringStartedAt)"] != nil
  }
}
