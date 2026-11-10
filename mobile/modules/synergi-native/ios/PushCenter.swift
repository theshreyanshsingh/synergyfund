import Foundation
import PushKit
import UIKit
import UserNotifications

func hexString(_ data: Data) -> String {
  data.map { String(format: "%02x", $0) }.joined()
}

// Apple push for this phone: the call address (PushKit: a call push rings through CallKit, even when the app is
// closed) and the notification address (messages, missed calls). A tap on a notification opens its page in the app.
// Used on the main queue only.
final class PushCenter: NSObject, PKPushRegistryDelegate, UNUserNotificationCenterDelegate {
  static let shared = PushCenter()

  private var registry: PKPushRegistry?
  private var voipWaiters: [(String?) -> Void] = []
  private var alertWaiters: [(String?) -> Void] = []
  private var alertFailed = false

  // A build for testing (Xcode, the Simulator) is reached through Apple's test service; TestFlight and the App Store
  // through the real one.
  let sandbox: Bool = {
    #if targetEnvironment(simulator)
    return true
    #else
    guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
          let data = FileManager.default.contents(atPath: path),
          let text = String(data: data, encoding: .isoLatin1) else { return false }
    return text.range(of: "<key>aps-environment</key>\\s*<string>development</string>", options: .regularExpression) != nil
    #endif
  }()

  // At launch, before anything else: a call push that woke a closed app is handled at once. The call address is only
  // asked for once someone is signed in on this phone.
  func start(_ application: UIApplication) {
    UNUserNotificationCenter.current().delegate = self
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = Store.deviceKey == nil ? [] : [.voIP]
    self.registry = registry
    application.registerForRemoteNotifications()
  }

  func setVoip(_ on: Bool) {
    registry?.desiredPushTypes = on ? [.voIP] : []
  }

  // The call address, asked for now if needed (nil if Apple gives none in time).
  func voipToken(timeout: TimeInterval, _ done: @escaping (String?) -> Void) {
    if registry == nil { start(UIApplication.shared) }
    if let data = registry?.pushToken(for: .voIP) {
      Store.voipToken = hexString(data)
      done(Store.voipToken)
      return
    }
    voipWaiters.append(done)
    setVoip(true)
    DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.resolveVoip(nil) }
  }

  func alertToken(timeout: TimeInterval, _ done: @escaping (String?) -> Void) {
    if let token = Store.alertToken {
      done(token)
      return
    }
    if alertFailed {
      done(nil)
      return
    }
    alertWaiters.append(done)
    DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.resolveAlert(nil) }
  }

  func requestAuthorization(_ done: @escaping (String) -> Void) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      DispatchQueue.main.async { done(granted ? "granted" : "denied") }
    }
  }

  func didRegister(alertToken data: Data) {
    let token = hexString(data)
    let changed = Store.alertToken != nil && Store.alertToken != token
    Store.alertToken = token
    alertFailed = false
    resolveAlert(token)
    if changed && Store.deviceKey != nil { Bridge.shared.emit("onToken", ["token": Store.voipToken ?? ""]) }
  }

  func didFailAlertToken() {
    alertFailed = true
    resolveAlert(nil)
  }

  private func resolveVoip(_ token: String?) {
    let waiters = voipWaiters
    voipWaiters = []
    for waiter in waiters { waiter(token ?? Store.voipToken) }
  }

  private func resolveAlert(_ token: String?) {
    let waiters = alertWaiters
    alertWaiters = []
    for waiter in waiters { waiter(token ?? Store.alertToken) }
  }

  // MARK: PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = hexString(pushCredentials.token)
    let changed = Store.voipToken != nil && Store.voipToken != token
    Store.voipToken = token
    resolveVoip(token)
    // A new call address: the app registers this phone again.
    if changed && Store.deviceKey != nil { Bridge.shared.emit("onToken", ["token": token]) }
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    if type == .voIP { Store.voipToken = nil }
  }

  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    guard type == .voIP else {
      completion()
      return
    }
    CallManager.shared.voipPush(payload.dictionaryPayload, completion: completion)
  }

  // MARK: Notifications

  // The app on screen shows messages and calls itself.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
       let href = response.notification.request.content.userInfo["href"] as? String,
       href.hasPrefix("/"), !href.hasPrefix("//") {
      Bridge.shared.deliverOpen(href)
    }
    completionHandler()
  }
}
