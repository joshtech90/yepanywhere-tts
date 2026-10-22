package de.joscha.yepcockpit

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast

/** "Teilen → An Yep Cockpit": Rechner waehlen, Inhalt sichern, Neue Sitzung oeffnen. */
class TeilenActivity : Activity() {
    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = listOfNotNull(
            intent.getStringExtra(Intent.EXTRA_SUBJECT),
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
        ).filter { it.isNotBlank() }.distinct().joinToString("\n\n")
        val quellen: List<Uri> = when (intent.action) {
            // Die typisierten Varianten gibt es erst ab Android 13.
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            else -> emptyList()
        }.filter { it.scheme == "content" }
        if (text.isBlank() && quellen.isEmpty()) {
            finish()
            return
        }
        val rechner = RechnerListe.alle
        if (rechner.size == 1) {
            uebergeben(rechner.first(), text, quellen)
            return
        }
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Neue Sitzung auf …")
            .setItems(rechner.map { it.name }.toTypedArray()) { _, i -> uebergeben(rechner[i], text, quellen) }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun uebergeben(r: Rechner, text: String, quellen: List<Uri>) {
        if (quellen.isNotEmpty()) Toast.makeText(this, "Wird übernommen …", Toast.LENGTH_SHORT).show()
        Thread({
            val ergebnis = runCatching { Teilen.speichern(applicationContext, text, quellen) }
            runOnUiThread {
                val (id, fehlend) = ergebnis.getOrElse {
                    // Beispielsweise voller privater Speicher: kein unbehandelter
                    // Fehler im Worker-Thread, der die ganze App beendet.
                    Toast.makeText(this, "Teilen gescheitert, bitte erneut versuchen", Toast.LENGTH_LONG).show()
                    finish()
                    return@runOnUiThread
                }
                if (fehlend > 0) {
                    Toast.makeText(
                        this, "$fehlend Datei(en) nicht übernommen (unlesbar oder zu groß)", Toast.LENGTH_LONG,
                    ).show()
                }
                startActivity(
                    Intent(this, MainActivity::class.java)
                        .putExtra(Meldungen.EXTRA_RECHNER, r.schluessel)
                        .putExtra(Teilen.EXTRA, id)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                finish()
            }
        }, "yep-teilen").start()
    }
}
