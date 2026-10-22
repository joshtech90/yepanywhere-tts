package de.joscha.yepcockpit

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * Empfaengt die verschluesselten Yep-Meldungen, die die Bruecke per FCM
 * weiterreicht. Daten: "r" = Rechner-Schluessel, "wp" = Web-Push-Inhalt
 * (aes128gcm, base64url). Ohne passenden Schluessel wird nichts angezeigt.
 */
class PushDienst : FirebaseMessagingService() {

    override fun onNewToken(token: String) = Push.tokenGeaendert(this)

    override fun onMessageReceived(nachricht: RemoteMessage) {
        val rechner = RechnerListe.nach(nachricht.data["r"])
        val inhalt = nachricht.data["wp"]
        if (rechner == null || inhalt == null) {
            Log.w(TAG, "Meldung ohne Rechner oder Inhalt verworfen")
            return
        }
        val klartext = try {
            WebPushEntschluesselung.entschluesseln(
                body = Schluessel.ausB64url(inhalt),
                empfaengerPublic = Schluessel.oeffentlich(),
                authSecret = Schluessel.authGeheimnis(this),
                ecdh = WebPushEntschluesselung.ecdhMitPrivatemSchluessel(Schluessel.privat()),
            )
        } catch (e: Exception) {
            // Altes Abo (Schluessel neu erzeugt) oder fremder Inhalt.
            Log.w(TAG, "Entschluesseln gescheitert: ${e.javaClass.simpleName}")
            return
        }
        val daten = try {
            JSONObject(klartext.toString(Charsets.UTF_8))
        } catch (e: Exception) {
            Log.w(TAG, "Inhalt ist kein JSON")
            return
        }
        Meldungen.verarbeiten(this, rechner, daten)
    }

    private companion object {
        const val TAG = "YEPC_PUSH"
    }
}
