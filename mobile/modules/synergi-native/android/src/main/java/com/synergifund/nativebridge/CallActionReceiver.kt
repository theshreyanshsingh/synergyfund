package com.synergifund.nativebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Decline (on the ringing notification) and Hang up (on the ongoing call notification), without opening the app.
class CallActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_DECLINE = "com.synergifund.nativebridge.DECLINE"
    const val ACTION_HANG_UP = "com.synergifund.nativebridge.HANG_UP"
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_DECLINE -> {
        val callId = intent.getStringExtra("callId") ?: return
        val pending = goAsync()
        Push.decline(context.applicationContext, callId) { pending.finish() }
      }
      ACTION_HANG_UP -> {
        CallService.stop(context)
        // The page leaves the call (the app's JavaScript passes it on).
        Bridge.emit("onHangUp")
      }
    }
  }
}
