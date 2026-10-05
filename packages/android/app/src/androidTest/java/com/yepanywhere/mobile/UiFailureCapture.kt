package com.yepanywhere.mobile

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File

/** Retain the visible window before fixture teardown removes the evidence. */
object UiFailureCapture {
    fun save(name: String, details: String = "") {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "live-failures").apply { mkdirs() }
        runCatching { device.takeScreenshot(File(directory, "$name.png")) }
        runCatching { device.dumpWindowHierarchy(File(directory, "$name.xml")) }
        runCatching {
            File(directory, "$name.txt").writeText(listOf(
                details,
                "screenOn=${device.isScreenOn}",
                device.executeShellCommand("dumpsys window"),
                device.executeShellCommand("dumpsys accessibility"),
                device.executeShellCommand("dumpsys power"),
            ).joinToString("\n"))
        }
    }
}
