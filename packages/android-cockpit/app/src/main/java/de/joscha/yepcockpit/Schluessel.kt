package de.joscha.yepcockpit

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * Empfaengerschluessel fuer Web Push (RFC 8291). Der private P-256-Schluessel
 * liegt nicht exportierbar im Android Keystore; die Server bekommen nur den
 * oeffentlichen Teil und das Auth-Geheimnis. Damit kann ausser dieser App
 * niemand die Meldungen lesen, auch nicht FCM oder die Bruecke auf aihub.
 */
object Schluessel {
    private const val ALIAS = "yep-webpush"
    private const val PREFS = "schluessel"

    @Synchronized
    fun privat(): PrivateKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? PrivateKey)?.let { return it }
        val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        gen.initialize(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_AGREE_KEY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .build(),
        )
        return gen.generateKeyPair().private
    }

    /** Oeffentlicher Schluessel, 65 Byte unkomprimiert (0x04 | X | Y). */
    @Synchronized
    fun oeffentlich(): ByteArray {
        privat()
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = ks.getCertificate(ALIAS).publicKey as ECPublicKey
        return byteArrayOf(4) + feld(key.w.affineX) + feld(key.w.affineY)
    }

    /** 16 zufaellige Byte, einmal je Installation. */
    fun authGeheimnis(ctx: Context): ByteArray = zufallsWert(ctx, "auth", 16)

    /** Kennung dieser Installation gegenueber den Yep-Servern. */
    fun installation(ctx: Context): String =
        zufallsWert(ctx, "installation", 12).joinToString("") { "%02x".format(it) }

    fun b64url(daten: ByteArray): String =
        Base64.encodeToString(daten, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    fun ausB64url(text: String): ByteArray = Base64.decode(text, Base64.URL_SAFE or Base64.NO_PADDING)

    @Synchronized
    private fun zufallsWert(ctx: Context, name: String, laenge: Int): ByteArray {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(name, null)?.let { return ausB64url(it) }
        val neu = ByteArray(laenge).also { SecureRandom().nextBytes(it) }
        prefs.edit().putString(name, b64url(neu)).commit()
        return neu
    }

    private fun feld(zahl: BigInteger): ByteArray {
        val roh = zahl.toByteArray()
        return when {
            roh.size == 32 -> roh
            roh.size > 32 -> roh.copyOfRange(roh.size - 32, roh.size)
            else -> ByteArray(32 - roh.size) + roh
        }
    }
}
