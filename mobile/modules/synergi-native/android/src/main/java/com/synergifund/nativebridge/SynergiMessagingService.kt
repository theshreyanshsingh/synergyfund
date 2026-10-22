package com.synergifund.nativebridge

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// Every message from the SynergiFund server arrives here, even when the app is closed: Android starts the app's
// process just for it. The server sends data-only messages, so this decides what the phone shows.
class SynergiMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    Push.handle(applicationContext, message.data)
  }

  override fun onNewToken(token: String) {
    Push.prefs(applicationContext).edit().putString("pushToken", token).apply()
    // The app registers the new address with the server the next time its page is open.
    Bridge.emit("onToken", mapOf("token" to token))
  }
}
