package com.synergifund.nativebridge

import android.Manifest
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

// While someone is on a call, Android keeps the app running (microphone, and camera on video) with an "Ongoing
// call" notification, so the call does not drop when the phone locks or another app is opened.
class CallService : Service() {
  companion object {
    private const val ACTION_START = "start"
    private const val ACTION_STOP = "stop"

    fun start(context: Context, title: String, body: String, video: Boolean) {
      val intent = Intent(context, CallService::class.java).setAction(ACTION_START)
        .putExtra("title", title)
        .putExtra("body", body)
        .putExtra("video", video)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (_: Exception) {
        // Android refused (for example, the app is in the background); the call carries on as it can.
      }
    }

    fun stop(context: Context) {
      try {
        context.startService(Intent(context, CallService::class.java).setAction(ACTION_STOP))
      } catch (_: Exception) {
        context.stopService(Intent(context, CallService::class.java))
      }
    }
  }

  private var startedAt = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    Push.ensureChannels(this)
    if (startedAt == 0L) startedAt = System.currentTimeMillis()
    val title = intent?.getStringExtra("title") ?: "SynergiFund call"
    val body = intent?.getStringExtra("body") ?: "Ongoing call"
    val video = intent?.getBooleanExtra("video", false) ?: false
    val pending = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val open = PendingIntent.getActivity(this, 7101, Push.openIntent(this, null), pending)
    val hangUp = PendingIntent.getBroadcast(this, 7102, Intent(this, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_HANG_UP), pending)
    val notification = NotificationCompat.Builder(this, Push.CHANNEL_ONGOING)
      .setSmallIcon(R.drawable.synergi_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setUsesChronometer(true)
      .setWhen(startedAt)
      .setContentIntent(open)
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(Person.Builder().setName(title).build(), hangUp).setIsVideo(video))
      .build()
    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (granted(Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (video && granted(Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      // Without the microphone there is nothing to keep alive.
      if (types == 0) {
        stopSelf()
        return START_NOT_STICKY
      }
    }
    try {
      ServiceCompat.startForeground(this, Push.ONGOING_ID, notification, types)
    } catch (_: Exception) {
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  override fun onDestroy() {
    startedAt = 0L
    super.onDestroy()
  }
}
