package de.joscha.yepcockpit

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.PrivateKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Entschluesselt Web-Push-Inhalte nach RFC 8291 mit der Inhaltskodierung
 * aes128gcm aus RFC 8188, so wie Yeps Server (Bibliothek web-push) sie
 * erzeugt. Nur ein Datensatz; Yep-Meldungen sind wenige hundert Byte.
 * Ohne Android-Klassen, damit der Test auf der JVM laeuft.
 */
object WebPushEntschluesselung {
    private const val KOPF = 16 + 4 + 1

    fun entschluesseln(
        body: ByteArray,
        empfaengerPublic: ByteArray,
        authSecret: ByteArray,
        ecdh: (ByteArray) -> ByteArray,
    ): ByteArray {
        require(body.size > KOPF) { "zu kurz" }
        val salt = body.copyOfRange(0, 16)
        val rs = ByteBuffer.wrap(body, 16, 4).int.toLong() and 0xffffffffL
        val idLaenge = body[20].toInt() and 0xff
        require(idLaenge == 65) { "keyid ist kein P-256-Schluessel" }
        require(rs >= 18) { "rs zu klein" }
        val start = KOPF + idLaenge
        require(body.size > start + 16) { "kein Inhalt" }
        require(body.size - start <= rs) { "mehr als ein Datensatz" }
        val senderPublic = body.copyOfRange(KOPF, start)

        // RFC 8291, Abschnitt 3.4
        val prkKey = hmac(authSecret, ecdh(senderPublic))
        val keyInfo = "WebPush: info".toByteArray() + 0.toByte() + empfaengerPublic + senderPublic
        val ikm = hkdfExpand(prkKey, keyInfo, 32)
        // RFC 8188, Abschnitt 2.2 und 2.3
        val prk = hmac(salt, ikm)
        val cek = hkdfExpand(prk, "Content-Encoding: aes128gcm".toByteArray() + 0.toByte(), 16)
        val nonce = hkdfExpand(prk, "Content-Encoding: nonce".toByteArray() + 0.toByte(), 12)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(cek, "AES"), GCMParameterSpec(128, nonce))
        val klar = cipher.doFinal(body, start, body.size - start)

        // Polsterung: hinter dem Inhalt folgt 0x02 (letzter Datensatz), dann Nullen.
        var ende = klar.size - 1
        while (ende >= 0 && klar[ende].toInt() == 0) ende--
        require(ende >= 0 && klar[ende].toInt() == 2) { "Trennbyte fehlt" }
        return klar.copyOfRange(0, ende)
    }

    /** ECDH mit einem privaten Schluessel (auch aus dem Android Keystore). */
    fun ecdhMitPrivatemSchluessel(privat: PrivateKey): (ByteArray) -> ByteArray = { punkt ->
        require(punkt.size == 65 && punkt[0].toInt() == 4) { "kein unkomprimierter Punkt" }
        val x = BigInteger(1, punkt.copyOfRange(1, 33))
        val y = BigInteger(1, punkt.copyOfRange(33, 65))
        val oeffentlich = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), p256()))
        KeyAgreement.getInstance("ECDH").run {
            init(privat)
            doPhase(oeffentlich, true)
            generateSecret()
        }
    }

    fun p256(): ECParameterSpec =
        AlgorithmParameters.getInstance("EC").run {
            init(ECGenParameterSpec("secp256r1"))
            getParameterSpec(ECParameterSpec::class.java)
        }

    private fun hmac(schluessel: ByteArray, daten: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(schluessel, "HmacSHA256"))
            doFinal(daten)
        }

    /** HKDF-Expand fuer hoechstens 32 Byte (ein Block). */
    private fun hkdfExpand(prk: ByteArray, info: ByteArray, laenge: Int): ByteArray =
        hmac(prk, info + 1.toByte()).copyOf(laenge)
}
