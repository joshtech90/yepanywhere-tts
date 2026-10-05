package com.yepanywhere.mobile.notifications

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.net.toUri
import com.yepanywhere.mobile.MainActivity
import com.yepanywhere.mobile.R
import com.yepanywhere.mobile.YaNativeRuntime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object NativePushPresenter {
    @Volatile var foreground = false
    const val SUBSCRIPTION_EXTRA = "yaPushSubscription"
    const val SESSION_EXTRA = "yaPushSession"
    private val opaque = Regex("^[A-Za-z0-9_-]{1,128}$")
    private val intents = setOf("approval_required", "input_required", "session_completed", "session_failed")

    suspend fun destination(runtime: YaNativeRuntime, subscriptionId: String): NativePushBinding? {
        if (!Regex("^[A-Za-z0-9_-]{22}$").matches(subscriptionId)) return null
        val binding = runtime.nativePush.bindings.all().find { it.subscriptionId == subscriptionId && it.enabled } ?: return null
        return binding.takeIf { runtime.nativePush.enabled(it.profileId) }
    }

    suspend fun present(context: Context, runtime: YaNativeRuntime, data: Map<String, String>): Boolean = withContext(Dispatchers.IO) {
        if (data["intent"] !in intents) return@withContext false
        val subscription = data["subscriptionId"] ?: return@withContext false
        val binding = destination(runtime, subscription) ?: return@withContext false
        if (foreground && data["test"] != "true") return@withContext false
        val session = data["sessionId"]?.takeIf(opaque::matches)
        val event = data["eventId"]?.takeIf(opaque::matches)
        val preferences = context.getSharedPreferences("ya_push_seen_v1", Context.MODE_PRIVATE)
        if (event != null && preferences.getString(subscription, null) == event) return@withContext false
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return@withContext false
        NotificationChannels.ensureActivityChannel(context)
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return@withContext false
        val launch = Intent(context, MainActivity::class.java).putExtra(SUBSCRIPTION_EXTRA, binding.subscriptionId).putExtra(SESSION_EXTRA, session)
            .setData("yep-anywhere-push:${binding.subscriptionId}:${session ?: "host"}".toUri())
        val pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val body = when (data["intent"]) {
            "approval_required" -> R.string.push_approval
            "input_required" -> if (data["test"] == "true") R.string.push_test_message else R.string.push_input
            "session_failed" -> R.string.push_failed
            else -> R.string.push_completed
        }
        val notification = NotificationCompat.Builder(context, context.getString(R.string.notification_channel_activity_id))
            .setSmallIcon(R.drawable.ic_stat_yep_anywhere).setContentTitle(context.getString(R.string.app_name)).setContentText(context.getString(body))
            .setAutoCancel(true).setOnlyAlertOnce(true).setContentIntent(pending).build()
        try { manager.notify("$subscription:${session ?: "host"}", 1, notification) } catch (_: SecurityException) { return@withContext false }
        if (event != null) {
            preferences.edit {
                if (preferences.all.size >= 64 && !preferences.contains(subscription)) clear()
                putString(subscription, event)
            }
        }
        true
    }
}
