package de.joscha.yepcockpit

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Looper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast
import org.robolectric.util.ReflectionHelpers
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class TeilenTest {
    @Test
    fun speicherfehlerBeendetTeilenOhneAbsturz() {
        val r = Rechner("mac", "Mac", Uri.parse("https://mac.example:3400"), 0, 0)
        val feld = RechnerListe::class.java.getDeclaredField("alle\$delegate").apply { isAccessible = true }
        val speicher = feld.get(null)
        val vorher = RechnerListe.alle
        ReflectionHelpers.setField(speicher, "_value", listOf(r))
        val ctx: Context = RuntimeEnvironment.getApplication()
        // Eine Datei an Stelle des Ablageordners: Schreiben scheitert wie bei vollem Speicher.
        val ablage = File(ctx.filesDir, "teilen").apply { deleteRecursively(); writeText("") }
        val controller = Robolectric.buildActivity(
            TeilenActivity::class.java,
            Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_TEXT, "Mein Text").setType("text/plain"),
        )
        try {
            val a = controller.setup().get()
            val ende = System.currentTimeMillis() + 5_000
            while (!a.isFinishing && System.currentTimeMillis() < ende) {
                Thread.sleep(10)
                shadowOf(Looper.getMainLooper()).idle()
            }
            assertTrue(a.isFinishing)
            assertEquals("Teilen gescheitert, bitte erneut versuchen", ShadowToast.getTextOfLatestToast())
            assertNull(shadowOf(a).nextStartedActivity)
        } finally {
            controller.destroy()
            ablage.delete()
            ReflectionHelpers.setField(speicher, "_value", vorher)
        }
    }
}
