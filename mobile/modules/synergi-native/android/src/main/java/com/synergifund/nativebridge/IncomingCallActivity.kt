package com.synergifund.nativebridge

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

// The incoming call screen, over the lock screen: who is calling, Decline and Answer. Answer unlocks the phone
// (when it is locked) and opens the call in the app.
class IncomingCallActivity : Activity() {
  private var callId = ""
  private val handler = Handler(Looper.getMainLooper())
  private val over = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val ended = intent.getStringExtra("callId")
      if (ended == null || ended == callId) finish()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    ContextCompat.registerReceiver(this, over, IntentFilter(Push.ACTION_CALL_OVER), ContextCompat.RECEIVER_NOT_EXPORTED)
    show(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    show(intent)
  }

  private fun show(intent: Intent) {
    callId = intent.getStringExtra("callId") ?: run { finish(); return }
    val until = intent.getLongExtra("until", 0L)
    val left = until - System.currentTimeMillis()
    if (left <= 0) {
      finish()
      return
    }
    handler.removeCallbacksAndMessages(null)
    handler.postDelayed({ finish() }, left)
    val title = intent.getStringExtra("title") ?: "Incoming call"
    val body = intent.getStringExtra("body") ?: ""
    setContentView(layout(title, body, intent.getBooleanExtra("video", false)))
  }

  private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  private fun layout(title: String, body: String, video: Boolean): View {
    val name = title.removeSuffix(" is calling you")
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setBackgroundColor(Color.parseColor("#111111"))
      setPadding(dp(24), dp(96), dp(24), dp(64))
    }
    val initials = name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "S" }
    root.addView(TextView(this).apply {
      text = initials
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#2C2F36")) }
      layoutParams = LinearLayout.LayoutParams(dp(112), dp(112))
    })
    root.addView(TextView(this).apply {
      text = name
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setPadding(0, dp(24), 0, dp(6))
    })
    root.addView(TextView(this).apply {
      text = if (body.isNotBlank()) body else if (video) "Video call" else "Voice call"
      setTextColor(Color.parseColor("#B5B8C0"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      gravity = Gravity.CENTER
    })
    root.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))
    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    buttons.addView(button("Decline", "#DC2626") { decline() }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    buttons.addView(button(if (video) "Answer video" else "Answer", "#16A34A") { answer() }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    root.addView(buttons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    return root
  }

  private fun button(label: String, color: String, onTap: () -> Unit): View {
    // The circle and its label both answer (or decline).
    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      isClickable = true
      contentDescription = label
      setOnClickListener { onTap() }
    }
    column.addView(TextView(this).apply {
      text = if (label.startsWith("Decline")) "✕" else "✓"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
      gravity = Gravity.CENTER
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor(color)) }
      contentDescription = label
      isClickable = true
      setOnClickListener { onTap() }
      layoutParams = LinearLayout.LayoutParams(dp(76), dp(76))
    })
    column.addView(TextView(this).apply {
      text = label
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      gravity = Gravity.CENTER
      setPadding(0, dp(10), 0, 0)
    })
    return column
  }

  private fun decline() {
    Push.decline(applicationContext, callId)
    finish()
  }

  private fun answer() {
    val id = callId
    Push.stopRinging(applicationContext, id, closeScreen = false)
    val open = { startActivity(Push.openIntent(this, "/calls?join=$id&answer=1")); finish() }
    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && keyguard.isKeyguardLocked) {
      keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() { open() }
        override fun onDismissCancelled() { finish() }
        override fun onDismissError() { open() }
      })
    } else {
      open()
    }
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    try { unregisterReceiver(over) } catch (_: Exception) {}
    super.onDestroy()
  }
}
