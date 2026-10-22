package com.synergifund.nativebridge

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// What the app's JavaScript can do natively on Android: get this phone's push address, keep a call alive in the
// background, and hear Hang up from the ongoing call notification.
class SynergiNativeModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app is not ready." }

  private fun setPageHidden(hidden: Boolean) {
    val state = if (hidden) "hidden" else "visible"
    runInPage("(function(){try{Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return '$state'}});" +
      "Object.defineProperty(document,'hidden',{configurable:true,get:function(){return $hidden}});" +
      "document.dispatchEvent(new Event('visibilitychange'));}catch(e){}})();")
  }

  private fun runInPage(script: String) {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      webViews(activity.window.decorView).forEach { it.evaluateJavascript(script, null) }
    }
  }

  private fun webViews(view: View): List<WebView> = when (view) {
    is WebView -> listOf(view)
    is ViewGroup -> (0 until view.childCount).flatMap { webViews(view.getChildAt(it)) }
    else -> emptyList()
  }

  private val DEBUG_PUSH = "com.synergifund.nativebridge.DEBUG_PUSH"
  private val debugPush = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val extras = intent.extras ?: return
      val data = extras.keySet().associateWith { extras.get(it)?.toString() ?: "" }
      // "hang-up" does what Hang up in the Ongoing call notification does.
      if (data["type"] == "hang-up") {
        context.sendBroadcast(Intent(context, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_HANG_UP))
        return
      }
      Push.handle(context.applicationContext, data)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SynergiNative")

    Events("onHangUp", "onToken", "onDecline")

    OnCreate {
      Push.ensureChannels(context)
      // Hang up and Decline go straight into the page: Android holds the app's own messages to it while the app is in
      // the background or under the call screen, and these must work with the phone locked.
      Bridge.listener = { event, payload ->
        when (event) {
          "onHangUp" -> runInPage("window.dispatchEvent(new Event('synergifund:hangup'));")
          "onDecline" -> runInPage("window.dispatchEvent(new CustomEvent('synergifund:decline',{detail:${org.json.JSONObject.quote(payload["callId"]?.toString() ?: "")}}));")
          else -> sendEvent(event, payload)
        }
      }
      // Debug builds only: a server message sent from a computer (adb), to test calls with the app in the background.
      if ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
        ContextCompat.registerReceiver(context, debugPush, IntentFilter(DEBUG_PUSH), ContextCompat.RECEIVER_EXPORTED)
      }
    }

    OnDestroy {
      Bridge.listener = null
      try { context.unregisterReceiver(debugPush) } catch (_: Exception) {}
    }

    // The page is on screen: it shows calls and messages itself, so the phone stops ringing for a call it shows.
    OnActivityEntersForeground {
      AppState.foreground = true
      Push.stopAnyRinging(context)
      setPageHidden(false)
    }

    // Android holds the app's messages to the page while it is in the background, so tell the page directly: it
    // then counts as away (the server sends pushes, and the page leaves the ringing to the phone).
    OnActivityEntersBackground {
      AppState.foreground = false
      setPageHidden(true)
    }

    // Whether Firebase is set up in this build (google-services.json was there when it was built).
    Function("isPushReady") {
      FirebaseApp.getApps(context).isNotEmpty()
    }

    // This phone's push address, or null when Firebase is not set up.
    AsyncFunction("getPushToken") { promise: Promise ->
      if (FirebaseApp.getApps(context).isEmpty()) {
        promise.resolve(null)
        return@AsyncFunction
      }
      FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        if (task.isSuccessful) {
          Push.prefs(context).edit().putString("pushToken", task.result).apply()
          promise.resolve(task.result)
        } else {
          promise.resolve(null)
        }
      }
    }

    // After the server registered this phone: where to send Decline, and the key that proves it is this phone.
    Function("configure") { origin: String, deviceKey: String ->
      Push.prefs(context).edit().putString("origin", origin).putString("deviceKey", deviceKey).apply()
    }

    // Signed out: this phone no longer gets anyone's calls or messages.
    Function("forget") {
      Push.prefs(context).edit().remove("deviceKey").apply()
    }

    Function("startCall") { title: String, body: String, video: Boolean ->
      CallService.start(context, title, body, video)
    }

    Function("endCall") {
      CallService.stop(context)
    }

    // Android 14+: whether calls may take over the screen when they ring (otherwise they show as a banner).
    Function("canUseFullScreen") {
      if (Build.VERSION.SDK_INT >= 34) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent()
      } else {
        true
      }
    }

    Function("openFullScreenSettings") {
      if (Build.VERSION.SDK_INT >= 34) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    // The same as a message from the server: the page passes on a ring it heard over its open connection.
    Function("showPush") { data: Map<String, String> ->
      Push.handle(context, data)
    }
  }
}
