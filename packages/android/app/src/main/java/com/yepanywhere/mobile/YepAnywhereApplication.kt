package com.yepanywhere.mobile

import android.app.Application
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.yepanywhere.mobile.notifications.NotificationChannels
import com.yepanywhere.mobile.notifications.NotificationFoundation
import com.yepanywhere.mobile.notifications.NativePushPresenter
import android.app.Activity
import android.os.Bundle

class YepAnywhereApplication : Application() {
    lateinit var nativeRuntime: YaNativeRuntime
        private set

    override fun onCreate() {
        super.onCreate()
        nativeRuntime = YaNativeRuntime(this)
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) { NativePushPresenter.foreground = true }
            override fun onActivityPaused(activity: Activity) { NativePushPresenter.foreground = false }
            override fun onActivityCreated(activity: Activity, state: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
        NotificationChannels.ensureActivityChannel(this)
        if (!NotificationFoundation.needsFirebaseRegistration(this)) {
            return
        }
        try {
            FirebaseMessaging.getInstance().register().addOnFailureListener {
                if (BuildConfig.DEBUG) {
                    Log.i(TAG, "FCM registration deferred")
                }
            }
        } catch (_: RuntimeException) {
            if (BuildConfig.DEBUG) {
                Log.i(TAG, "FCM registration unavailable")
            }
        }
    }

    companion object {
        private const val TAG = "YepAnywhereFCM"
    }
}
