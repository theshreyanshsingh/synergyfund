import ExpoModulesCore
import Foundation

// The app's JavaScript side of calls and notifications on iPhone. The same functions as on Android (so App.js treats
// both alike), plus what only iPhone needs: the notification address, the permission prompt, and an answered call or a
// tapped notification waiting from before the page existed.
public final class SynergiNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SynergiNative")

    Events("onToken", "onAnswer", "onDecline", "onOpen", "onHangUp")

    OnCreate {
      Bridge.shared.attach { [weak self] event, body in self?.sendEvent(event, body) }
    }

    OnDestroy {
      Bridge.shared.detach()
    }

    OnStartObserving("onAnswer") { Bridge.shared.listen("onAnswer", true) }
    OnStopObserving("onAnswer") { Bridge.shared.listen("onAnswer", false) }
    OnStartObserving("onOpen") { Bridge.shared.listen("onOpen", true) }
    OnStopObserving("onOpen") { Bridge.shared.listen("onOpen", false) }

    // Calls ring on iPhone and iPad (not when the app runs on a Mac).
    Function("isPushReady") {
      !ProcessInfo.processInfo.isiOSAppOnMac
    }

    // The call address, which is also the phone's name on the server.
    AsyncFunction("getPushToken") { (promise: Promise) in
      PushCenter.shared.voipToken(timeout: 10) { promise.resolve($0) }
    }.runOnQueue(.main)

    // The notification address (empty when Apple gave none) and whether this is a test build.
    AsyncFunction("pushExtras") { (promise: Promise) in
      PushCenter.shared.alertToken(timeout: 5) { token in
        promise.resolve(["alertToken": token ?? "", "sandbox": PushCenter.shared.sandbox])
      }
    }.runOnQueue(.main)

    // Asks once (iOS shows its prompt only the first time): "granted" or "denied".
    AsyncFunction("requestNotifications") { (promise: Promise) in
      PushCenter.shared.requestAuthorization { promise.resolve($0) }
    }.runOnQueue(.main)

    // After the server registered this phone: where to send Decline, and the key that proves it is this phone.
    Function("configure") { (origin: String, deviceKey: String) in
      Store.origin = origin
      Store.deviceKey = deviceKey
      DispatchQueue.main.async { PushCenter.shared.setVoip(true) }
    }

    // Signed out: this phone no longer rings for anyone.
    Function("forget") {
      Store.deviceKey = nil
      DispatchQueue.main.async {
        PushCenter.shared.setVoip(false)
        CallManager.shared.endAll()
      }
    }

    // The page is in a call (or not). On iPhone the call stays in the page; this only keeps CallKit out of its way.
    Function("startCall") { (_: String, _: String, _: Bool) in
      DispatchQueue.main.async { CallManager.shared.pageInCall = true }
    }

    Function("endCall") {
      DispatchQueue.main.async { CallManager.shared.pageInCall = false }
    }

    Function("canUseFullScreen") { true }

    Function("openFullScreenSettings") {}

    // The page heard a ring, or its end, over its open connection.
    Function("showPush") { (data: [String: String]) in
      DispatchQueue.main.async { CallManager.shared.pageMessage(data) }
    }

    Function("takeAnswer") { Bridge.shared.takeAnswer() }

    Function("takeOpenPath") { Bridge.shared.takeOpenPath() }
  }
}
