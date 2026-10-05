package com.yepanywhere.mobile

import android.os.Build
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import org.junit.rules.ExternalResource

/** A crashed emulator launcher must not obscure the application under test. */
class LauncherAnrRecoveryRule : ExternalResource() {
    private var device: UiDevice? = null
    private var handled = false

    override fun before() {
        if (Build.HARDWARE !in setOf("ranchu", "goldfish")) return
        val current = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device = current
        current.registerWatcher(WATCHER) {
            // Run 37219989321 captured this system-owned dialog above a healthy
            // YA page. Recover once, only for Pixel Launcher; YA ANRs still fail.
            val title = current.findObject(By.pkg("android").res("android", "alertTitle")
                .text("Pixel Launcher isn't responding"))
            val close = current.findObject(By.pkg("android").res("android", "aerr_close"))
            if (handled || title == null || close == null) return@registerWatcher false
            handled = true
            UiFailureCapture.save("pixel-launcher-anr")
            Log.i("YaUiEnvironment", "Closing the emulator Pixel Launcher ANR dialog")
            close.click()
            true
        }
    }

    override fun after() { device?.removeWatcher(WATCHER) }

    companion object { private const val WATCHER = "emulator-pixel-launcher-anr" }
}
