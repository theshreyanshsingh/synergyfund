import ExpoModulesCore
import UIKit

// Runs with the app itself, before React Native starts: a call push that woke a closed app finds CallKit and PushKit
// ready. Also passes on the notification address and the app coming to or leaving the screen.
public final class SynergiAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    guard !ProcessInfo.processInfo.isiOSAppOnMac else { return false }
    CallManager.shared.start()
    PushCenter.shared.start(application)
    return false
  }

  public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    PushCenter.shared.didRegister(alertToken: deviceToken)
  }

  public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    PushCenter.shared.didFailAlertToken()
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    CallManager.shared.appBecameActive()
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    CallManager.shared.appEnteredBackground()
  }
}
