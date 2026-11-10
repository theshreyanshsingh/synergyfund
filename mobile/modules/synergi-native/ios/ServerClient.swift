import Foundation
import UIKit

// The phone's own requests to the server, outside the page (which may not be running): Decline, and whether a ringing
// call still rings. The phone proves itself with its call address and its own key.
enum ServerClient {
  private static func post(_ path: String, _ body: [String: Any], done: @escaping (Int, [String: Any]?) -> Void) {
    guard let origin = Store.origin, let key = Store.deviceKey, let token = Store.voipToken, let url = URL(string: origin + path) else {
      done(401, nil)
      return
    }
    var request = URLRequest(url: url, timeoutInterval: 8)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    var payload = body
    payload["token"] = token
    payload["deviceKey"] = key
    request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
    URLSession.shared.dataTask(with: request) { data, response, _ in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      DispatchQueue.main.async { done(status, json) }
    }.resume()
  }

  // Finishes even if the phone locks or the app goes to the background right after Decline.
  static func decline(_ callId: String) {
    var task = UIBackgroundTaskIdentifier.invalid
    let finish = {
      if task != .invalid {
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
      }
    }
    task = UIApplication.shared.beginBackgroundTask(withName: "Decline call", expirationHandler: finish)
    post("/api/push/native/decline", ["callId": callId]) { _, _ in finish() }
  }

  // answering: the person answered on this phone and is unlocking it, so the call waits for them a little longer.
  static func ringState(_ callId: String, answering: Bool = false, done: @escaping (Int, String?) -> Void) {
    post("/api/push/native/call", ["callId": callId, "answering": answering]) { status, json in
      done(status, json?["state"] as? String)
    }
  }
}
