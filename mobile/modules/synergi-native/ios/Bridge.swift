import Foundation

// Events for the app's JavaScript. An answered call and a tapped notification are kept until JavaScript listens: the
// phone may have started the app just now, before its page exists.
final class Bridge {
  static let shared = Bridge()

  private let lock = NSLock()
  private var send: ((String, [String: Any]) -> Void)?
  private var listening = Set<String>()
  private var answer: (callId: String, at: Date)?
  // Answered on the phone's call screen, and not yet handed to the page (the phone is unlocking, or the call screen
  // is letting go of the sound).
  private var answering: (callId: String, at: Date)?
  private var openPath: String?

  func attach(_ send: @escaping (String, [String: Any]) -> Void) {
    lock.lock()
    self.send = send
    lock.unlock()
  }

  func detach() {
    lock.lock()
    send = nil
    listening.removeAll()
    lock.unlock()
  }

  func listen(_ event: String, _ on: Bool) {
    lock.lock()
    if on { listening.insert(event) } else { listening.remove(event) }
    lock.unlock()
    if on { flush() }
  }

  func emit(_ event: String, _ body: [String: Any] = [:]) {
    lock.lock()
    let send = self.send
    lock.unlock()
    send?(event, body)
  }

  func deliverAnswer(_ callId: String) {
    lock.lock()
    answer = (callId, Date())
    answering = nil
    lock.unlock()
    flush()
  }

  func setAnswering(_ callId: String) {
    lock.lock()
    answering = (callId, Date())
    lock.unlock()
  }

  func stopAnswering(_ callId: String) {
    lock.lock()
    if answering?.callId == callId { answering = nil }
    lock.unlock()
  }

  // A call answered on the phone's call screen is on its way to the page (onAnswer, or takeAnswer).
  func answerPending() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    let now = Date()
    if let held = answer, now.timeIntervalSince(held.at) < 60 { return true }
    if let waiting = answering, now.timeIntervalSince(waiting.at) < 60 { return true }
    return false
  }

  func deliverOpen(_ path: String) {
    lock.lock()
    openPath = path
    lock.unlock()
    flush()
  }

  // An answer older than a minute is stale: the call has moved on.
  func takeAnswer() -> String? {
    lock.lock()
    defer { lock.unlock() }
    guard let held = answer else { return nil }
    answer = nil
    return Date().timeIntervalSince(held.at) < 60 ? held.callId : nil
  }

  func takeOpenPath() -> String? {
    lock.lock()
    defer { lock.unlock() }
    let path = openPath
    openPath = nil
    return path
  }

  private func flush() {
    lock.lock()
    let send = self.send
    var events: [(String, [String: Any])] = []
    if send != nil, listening.contains("onAnswer"), let held = answer {
      if Date().timeIntervalSince(held.at) < 60 { events.append(("onAnswer", ["callId": held.callId])) }
      answer = nil
    }
    if send != nil, listening.contains("onOpen"), let path = openPath {
      events.append(("onOpen", ["path": path]))
      openPath = nil
    }
    lock.unlock()
    for (event, body) in events { send?(event, body) }
  }
}
