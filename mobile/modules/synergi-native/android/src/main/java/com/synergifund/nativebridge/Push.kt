package com.synergifund.nativebridge

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
import org.json.JSONObject

// Whether the app's own screen (the website) is open right now. Then the page itself shows calls and messages,
// so the phone does not ring or notify a second time. False when Android started the app just for a message.
object AppState {
  @Volatile var foreground = false
}

// Events for the app's JavaScript (Hang up from the notification, a new push token).
object Bridge {
  @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null
  fun emit(event: String, payload: Map<String, Any?> = emptyMap()) {
    listener?.invoke(event, payload)
  }
}

object Push {
  const val CHANNEL_CALLS = "calls"
  const val CHANNEL_ALERTS = "alerts"
  const val CHANNEL_ONGOING = "ongoing_call"
  const val ACTION_CALL_OVER = "com.synergifund.nativebridge.CALL_OVER"
  const val ONGOING_ID = 7001
  private const val RING_DEFAULT_MS = 45000L

  fun prefs(context: Context): SharedPreferences = context.getSharedPreferences("synergi_native", Context.MODE_PRIVATE)

  // The channels people see in Android's settings for the app.
  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    val calls = NotificationChannel(CHANNEL_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Rings when someone calls you"
      setSound(ringtone, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 1000, 1000)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    val alerts = NotificationChannel(CHANNEL_ALERTS, "Messages and alerts", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Messages, mentions, tasks, expenses and other updates"
    }
    val ongoing = NotificationChannel(CHANNEL_ONGOING, "Ongoing calls", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shown while you are on a call"
      setSound(null, null)
    }
    manager.createNotificationChannels(listOf(calls, alerts, ongoing))
  }

  fun handle(context: Context, data: Map<String, String>) {
    ensureChannels(context)
    when (data["type"]) {
      "call" -> incomingCall(context, data)
      "call-over" -> callOver(context, data)
      else -> alert(context, data)
    }
  }

  fun callNotificationId(callId: String) = 1000 + (callId.hashCode() and 0x0fffffff) % 5000

  private fun allowed(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
  }

  // Opens a page of the app (a path such as /calls?answer=…), or the app's start page.
  fun openIntent(context: Context, path: String?): Intent {
    val target = if (path.isNullOrBlank()) "/" else path
    return Intent(Intent.ACTION_VIEW, Uri.parse("synergifund://open?path=" + Uri.encode(target)))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }

  private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  // "Name is calling you": rings until it is answered, declined, the call ends or the ring runs out.
  private fun incomingCall(context: Context, data: Map<String, String>) {
    val callId = data["callId"] ?: return
    // The app is open: the page shows its own ringing card.
    if (AppState.foreground) return
    if (ended(context, callId)) return
    val ringFor = data["ringFor"]?.toLongOrNull() ?: RING_DEFAULT_MS
    val sentAt = data["sentAt"]?.toLongOrNull() ?: System.currentTimeMillis()
    val left = sentAt + ringFor - System.currentTimeMillis()
    // A late copy of a ring that already ran out.
    if (left < 2000) return
    if (!allowed(context)) return
    val id = callNotificationId(callId)
    val title = data["title"] ?: "Incoming call"
    val body = data["body"] ?: ""
    val video = data["media"] == "video"
    val screen = Intent(context, IncomingCallActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
      .putExtra("callId", callId)
      .putExtra("title", title)
      .putExtra("body", body)
      .putExtra("video", video)
      .putExtra("until", System.currentTimeMillis() + left)
    val screenIntent = PendingIntent.getActivity(context, id, screen, flags())
    val answer = PendingIntent.getActivity(context, id + 1, openIntent(context, "/calls?join=$callId&answer=1"), flags())
    val decline = PendingIntent.getBroadcast(
      context,
      id + 2,
      Intent(context, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_DECLINE).putExtra("callId", callId),
      flags(),
    )
    val caller = Person.Builder().setName(data["caller"] ?: title).setImportant(true).build()
    val builder = NotificationCompat.Builder(context, CHANNEL_CALLS)
      .setSmallIcon(R.drawable.synergi_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      // The page and the push can both announce the same call: ring once, update quietly.
      .setOnlyAlertOnce(true)
      .setTimeoutAfter(left)
      .setContentIntent(screenIntent)
      .setFullScreenIntent(screenIntent, true)
      .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(video))
    val notification = builder.build().apply { flags = flags or Notification.FLAG_INSISTENT }
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
      prefs(context).edit().putString("ringing", callId).apply()
    } catch (_: SecurityException) {
    }
  }

  // The call was answered elsewhere, declined, ended or missed: stop ringing, and say "Missed call" when it was.
  private fun callOver(context: Context, data: Map<String, String>) {
    val callId = data["callId"] ?: return
    stopRinging(context, callId)
    if (data["quiet"] != "true" && !AppState.foreground) alert(context, data + mapOf("tag" to "missed-$callId"))
  }

  // closeScreen false: the call screen itself is answering, and closes when the call opens.
  fun stopRinging(context: Context, callId: String, closeScreen: Boolean = true) {
    markEnded(context, callId)
    NotificationManagerCompat.from(context).cancel(callNotificationId(callId))
    if (closeScreen) context.sendBroadcast(Intent(ACTION_CALL_OVER).setPackage(context.packageName).putExtra("callId", callId))
    if (prefs(context).getString("ringing", null) == callId) prefs(context).edit().remove("ringing").apply()
  }

  // Opening the app while a call rings: the page shows the ringing card instead.
  fun stopAnyRinging(context: Context) {
    val callId = prefs(context).getString("ringing", null) ?: return
    NotificationManagerCompat.from(context).cancel(callNotificationId(callId))
    context.sendBroadcast(Intent(ACTION_CALL_OVER).setPackage(context.packageName).putExtra("callId", callId))
    prefs(context).edit().remove("ringing").apply()
  }

  private fun ended(context: Context, callId: String) = prefs(context).getLong("ended:$callId", 0L) > 0L

  private fun markEnded(context: Context, callId: String) {
    val prefs = prefs(context)
    val now = System.currentTimeMillis()
    val editor = prefs.edit().putLong("ended:$callId", now)
    // Forget old ones after a day.
    for ((key, value) in prefs.all) if (key.startsWith("ended:") && value is Long && now - value > 86_400_000L) editor.remove(key)
    editor.apply()
  }

  // Messages, mentions, tasks and the rest. One notification per tag, so a burst of chat messages updates one line.
  private fun alert(context: Context, data: Map<String, String>) {
    if (AppState.foreground) return
    if (!allowed(context)) return
    val title = data["title"] ?: return
    val tag = data["tag"] ?: "note-${System.currentTimeMillis()}"
    val id = 20000 + (tag.hashCode() and 0x0fffffff) % 100000
    val open = PendingIntent.getActivity(context, id, openIntent(context, data["href"]), flags())
    val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
      .setSmallIcon(R.drawable.synergi_notification)
      .setContentTitle(title)
      .setContentText(data["body"] ?: "")
      .setStyle(NotificationCompat.BigTextStyle().bigText(data["body"] ?: ""))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(if (data["kind"] == "message") NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (_: SecurityException) {
    }
  }

  // Tells the server this phone declined, using the device's own key (no sign-in cookie outside the app's page).
  fun decline(context: Context, callId: String, done: () -> Unit = {}) {
    stopRinging(context, callId)
    // The page declines over its open connection when the app is running (fastest, and works before this phone has
    // a push key); the server request below covers a closed app.
    Bridge.emit("onDecline", mapOf("callId" to callId))
    val prefs = prefs(context)
    val origin = prefs.getString("origin", null)
    val token = prefs.getString("pushToken", null)
    val key = prefs.getString("deviceKey", null)
    if (origin == null || token == null || key == null) {
      done()
      return
    }
    thread {
      try {
        val connection = URL("$origin/api/push/native/decline").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 10000
        connection.readTimeout = 10000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        val body = JSONObject().put("token", token).put("deviceKey", key).put("callId", callId).toString()
        connection.outputStream.use { it.write(body.toByteArray()) }
        connection.responseCode
        connection.disconnect()
      } catch (_: Exception) {
      } finally {
        done()
      }
    }
  }
}
