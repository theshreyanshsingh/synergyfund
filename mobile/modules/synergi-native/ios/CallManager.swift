import AVFAudio
import CallKit
import CryptoKit
import Foundation
import UIKit

// Incoming calls on the iPhone's own call screen (CallKit), over the lock screen too. CallKit only rings: the call
// itself runs in the app's page, which cannot share the sound with CallKit, so Answer opens the app (calls are shown
// as video calls, the only kind iOS opens the app for after Face ID) and hands the call to the page; Decline turns it
// down without opening the app. Apple wants every call push to ring, so no push stops a ring: while one rings here
// the phone asks the server every 2 seconds whether it still should (answered elsewhere, the caller hung up, missed).
// While the app is on screen its page shows the ringing card instead. Used on the main queue only.
final class CallManager: NSObject, CXProviderDelegate {
  static let shared = CallManager()

  // Who shows the ring: the page (the app is on screen), CallKit, or CallKit after Answer (waiting for the app).
  private enum Owner { case page, callKit, answered }

  private struct Ring {
    let callId: String
    let ringStartedAt: Int64
    var caller: String
    var deadline: Date
    var owner: Owner
    var uuid: UUID?
    var generation = 0
    // The page has heard this ring (it shows the ringing card when the app is on screen).
    var pageKnows = false
  }

  private var provider: CXProvider?
  private var rings: [String: Ring] = [:]
  private var poller: Timer?
  private var audioActive = false
  private var afterAudio: [() -> Void] = []
  // The page is in a call: another call rings in the page only (CallKit would take the call's sound).
  var pageInCall = false

  private var appActive: Bool { UIApplication.shared.applicationState == .active }

  func start() {
    guard provider == nil, !ProcessInfo.processInfo.isiOSAppOnMac else { return }
    let config = CXProviderConfiguration()
    config.supportsVideo = true
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    // Calls are not listed in the Phone app: calling back from there is not something this app does.
    config.includesCallsInRecents = false
    let provider = CXProvider(configuration: config)
    provider.setDelegate(self, queue: nil)
    self.provider = provider
  }

  // MARK: Rings arriving

  // A call push. It must be reported to CallKit before this returns, whatever happens next.
  func voipPush(_ payload: [AnyHashable: Any], completion: @escaping () -> Void) {
    start()
    guard let provider else {
      completion()
      return
    }
    let callId = payload["callId"] as? String ?? ""
    let ringStartedAt = Self.int64(payload["ringStartedAt"])
    let ringFor = Double(Self.int64(payload["ringFor"]) ?? 45000) / 1000
    let caller = Self.text(payload["caller"]) ?? "SynergiFund"
    let left = Self.timeLeft(ringStartedAt, ringFor)
    let existing = rings[callId].flatMap { Self.sameRing($0, ringStartedAt) ? $0 : nil }
    // Already on CallKit (the page passed it on first): reported again under the same name, as Apple asks.
    if let ring = existing, ring.owner != .page, let uuid = ring.uuid {
      provider.reportNewIncomingCall(with: uuid, update: Self.update(caller)) { _ in DispatchQueue.main.async { completion() } }
      return
    }
    let unwanted = callId.isEmpty || Store.deviceKey == nil || left < 2 || Store.endedHere(callId, ringStartedAt ?? 0) || pageInCall
    // A late push, signed out, or the page already shows it on screen: rung and ended in the same moment.
    if unwanted || (existing != nil && appActive) {
      reportAndEnd(caller, completion)
      return
    }
    var ring = existing ?? Ring(callId: callId, ringStartedAt: ringStartedAt ?? 0, caller: caller, deadline: Date().addingTimeInterval(left + 2), owner: .callKit)
    ring.generation += existing == nil ? 0 : 1
    report(ring, completion)
  }

  // From the page: it heard a ring (or its end) over its open connection.
  func pageMessage(_ data: [String: String]) {
    start()
    guard let callId = data["callId"], !callId.isEmpty else { return }
    if data["type"] == "call-over" {
      end(callId, reason: .remoteEnded)
      return
    }
    guard data["type"] == "call" else { return }
    let ringStartedAt = Int64(data["ringStartedAt"] ?? "").flatMap { $0 > 0 ? $0 : nil }
    if var ring = rings[callId], Self.sameRing(ring, ringStartedAt) {
      ring.pageKnows = true
      rings[callId] = ring
      // CallKit rings while the app is on screen: the page's ringing card takes over.
      if ring.owner == .callKit && appActive { handBackToPage(callId) }
      return
    }
    let left = Self.timeLeft(ringStartedAt, (Double(data["ringFor"] ?? "") ?? 45000) / 1000)
    if left < 2 || Store.endedHere(callId, ringStartedAt ?? 0) { return }
    var ring = Ring(callId: callId, ringStartedAt: ringStartedAt ?? 0, caller: Self.text(data["caller"]) ?? "SynergiFund", deadline: Date().addingTimeInterval(left + 2), owner: .page)
    ring.pageKnows = true
    rings[callId] = ring
    if !appActive && !pageInCall { report(ring) }
  }

  // The app left the screen while its page was ringing: CallKit rings instead.
  func appEnteredBackground() {
    for ring in rings.values where ring.owner == .page && !pageInCall {
      guard ring.deadline.timeIntervalSinceNow > 2 else {
        rings[ring.callId] = nil
        continue
      }
      var next = ring
      next.generation += 1
      report(next)
    }
  }

  // Back on screen: an answered call goes to the page; a ring the page knows about rings there again.
  func appBecameActive() {
    for ring in rings.values {
      if ring.owner == .answered { handOver(ring.callId) }
      else if ring.owner == .callKit && ring.pageKnows { handBackToPage(ring.callId) }
    }
  }

  // Signed out: nothing rings any more (without declining anything).
  func endAll() {
    for callId in Array(rings.keys) { end(callId, reason: .remoteEnded) }
  }

  // MARK: CallKit

  func providerDidReset(_ provider: CXProvider) {
    rings.removeAll()
    stopPolling()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let callId = callId(for: action.callUUID) else {
      action.fail()
      return
    }
    rings[callId]?.owner = .answered
    // Time to unlock the phone and open the app; the server holds the call meanwhile.
    rings[callId]?.deadline = Date().addingTimeInterval(50)
    action.fulfill()
    ServerClient.ringState(callId, answering: true) { _, _ in }
    if appActive { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.handOver(callId) } }
  }

  // Decline (or End before the app opened): turned down on the server.
  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let callId = callId(for: action.callUUID)
    action.fulfill()
    guard let callId, let ring = rings.removeValue(forKey: callId) else { return }
    Store.markEnded(callId, ring.ringStartedAt)
    ServerClient.decline(callId)
    Bridge.shared.emit("onDecline", ["callId": callId])
    stopPollingIfIdle()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    audioActive = true
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    audioActive = false
    let waiting = afterAudio
    afterAudio = []
    for run in waiting { run() }
  }

  // MARK: Handing over

  // Answered, and the app is on screen: CallKit lets go, and once its sound is off the page joins the call.
  private func handOver(_ callId: String) {
    guard let ring = rings[callId], ring.owner == .answered else { return }
    rings[callId] = nil
    Store.markEnded(callId, ring.ringStartedAt)
    if let uuid = ring.uuid { provider?.reportCall(with: uuid, endedAt: nil, reason: .answeredElsewhere) }
    stopPollingIfIdle()
    let deliver = { Bridge.shared.deliverAnswer(callId) }
    guard audioActive else {
      deliver()
      return
    }
    var delivered = false
    let once = {
      if delivered { return }
      delivered = true
      deliver()
    }
    afterAudio.append(once)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { once() }
  }

  private func handBackToPage(_ callId: String) {
    guard var ring = rings[callId], let uuid = ring.uuid else { return }
    provider?.reportCall(with: uuid, endedAt: nil, reason: .answeredElsewhere)
    ring.owner = .page
    ring.uuid = nil
    rings[callId] = ring
    stopPollingIfIdle()
  }

  // MARK: Reporting

  private func report(_ ring: Ring, _ completion: (() -> Void)? = nil) {
    var ring = ring
    let uuid = Self.uuid(ring.callId, ring.ringStartedAt, ring.generation)
    ring.uuid = uuid
    ring.owner = .callKit
    rings[ring.callId] = ring
    provider?.reportNewIncomingCall(with: uuid, update: Self.update(ring.caller)) { [weak self] error in
      DispatchQueue.main.async {
        guard let self else { return }
        if error != nil {
          // Do Not Disturb, a blocked caller, or iOS said no: the page still shows it when the app is opened.
          if var current = self.rings[ring.callId], current.uuid == uuid {
            current.owner = .page
            current.uuid = nil
            self.rings[ring.callId] = current
          }
        } else {
          self.poll()
        }
        completion?()
      }
    }
    if provider == nil { completion?() }
  }

  private func reportAndEnd(_ caller: String, _ completion: @escaping () -> Void) {
    let uuid = UUID()
    provider?.reportNewIncomingCall(with: uuid, update: Self.update(caller)) { [weak self] _ in
      DispatchQueue.main.async {
        self?.provider?.reportCall(with: uuid, endedAt: nil, reason: .remoteEnded)
        completion()
      }
    }
  }

  private func end(_ callId: String, reason: CXCallEndedReason) {
    guard let ring = rings.removeValue(forKey: callId) else { return }
    Store.markEnded(callId, ring.ringStartedAt)
    if ring.owner != .page, let uuid = ring.uuid { provider?.reportCall(with: uuid, endedAt: nil, reason: reason) }
    stopPollingIfIdle()
  }

  // MARK: Asking the server

  private func poll() {
    if poller == nil {
      poller = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
    }
    tick()
  }

  private func tick() {
    let now = Date()
    for ring in rings.values where ring.owner != .page {
      if ring.deadline < now {
        end(ring.callId, reason: ring.owner == .answered ? .failed : .unanswered)
        continue
      }
      ServerClient.ringState(ring.callId) { [weak self] status, state in
        guard let self, let current = self.rings[ring.callId], current.owner != .page else { return }
        // This phone is no longer signed in.
        if status == 401 {
          self.end(ring.callId, reason: .remoteEnded)
          return
        }
        guard status == 200, let state else { return }
        switch state {
        case "ringing": break
        case "answered": self.end(ring.callId, reason: .answeredElsewhere)
        case "declined": self.end(ring.callId, reason: .declinedElsewhere)
        case "missed": self.end(ring.callId, reason: .unanswered)
        default: self.end(ring.callId, reason: .remoteEnded)
        }
      }
    }
    stopPollingIfIdle()
  }

  private func stopPollingIfIdle() {
    if !rings.values.contains(where: { $0.owner != .page }) { stopPolling() }
  }

  private func stopPolling() {
    poller?.invalidate()
    poller = nil
  }

  // MARK: Helpers

  private func callId(for uuid: UUID) -> String? {
    rings.values.first(where: { $0.uuid == uuid })?.callId
  }

  // Every call is a video call to iOS: answering one on a locked phone opens the app after Face ID.
  private static func update(_ caller: String) -> CXCallUpdate {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: caller)
    update.localizedCallerName = caller
    update.hasVideo = true
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    return update
  }

  // The same call rings under a new name each time it rings again (generation), so CallKit never mixes them up.
  private static func uuid(_ callId: String, _ ringStartedAt: Int64, _ generation: Int) -> UUID {
    var bytes = Array(SHA256.hash(data: Data("\(callId):\(ringStartedAt):\(generation)".utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x50
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    return bytes.withUnsafeBufferPointer { NSUUID(uuidBytes: $0.baseAddress!) as UUID }
  }

  private static func sameRing(_ ring: Ring, _ ringStartedAt: Int64?) -> Bool {
    guard let ringStartedAt, ring.ringStartedAt > 0 else { return true }
    return ring.ringStartedAt == ringStartedAt
  }

  private static func timeLeft(_ ringStartedAt: Int64?, _ ringFor: TimeInterval) -> TimeInterval {
    guard let ringStartedAt else { return ringFor }
    return Date(timeIntervalSince1970: Double(ringStartedAt) / 1000).addingTimeInterval(ringFor).timeIntervalSinceNow
  }

  private static func int64(_ value: Any?) -> Int64? {
    if let number = value as? NSNumber { return number.int64Value }
    if let text = value as? String { return Int64(text) }
    return nil
  }

  private static func text(_ value: Any?) -> String? {
    guard let text = value as? String, !text.isEmpty else { return nil }
    return text
  }
}
