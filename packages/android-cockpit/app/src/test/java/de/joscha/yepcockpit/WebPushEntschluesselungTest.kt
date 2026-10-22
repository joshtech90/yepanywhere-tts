package de.joscha.yepcockpit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.math.BigInteger
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.spec.ECPrivateKeySpec
import java.util.Base64

/**
 * Beispiel aus RFC 8291, Abschnitt 5 und Anhang A. Bricht die Entschluesselung,
 * kommen auf dem Handy keine Meldungen mehr an, ohne dass es jemand merkt.
 */
class WebPushEntschluesselungTest {
    private fun b64(s: String): ByteArray = Base64.getUrlDecoder().decode(s.replace(" ", ""))

    private val body = b64(
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
            "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
            "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    )
    private val uaPublic = b64(
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx" +
            "aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    )
    private val authSecret = b64("BTBZMqHH6r4Tts7J_aSIgg")
    private val uaPrivate = KeyFactory.getInstance("EC").generatePrivate(
        ECPrivateKeySpec(
            BigInteger(1, b64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94")),
            WebPushEntschluesselung.p256(),
        ),
    )

    @Test
    fun entschluesseltDasRfcBeispiel() {
        val klar = WebPushEntschluesselung.entschluesseln(
            body, uaPublic, authSecret, WebPushEntschluesselung.ecdhMitPrivatemSchluessel(uaPrivate),
        )
        assertEquals("When I grow up, I want to be a watermelon", klar.toString(Charsets.UTF_8))
    }

    @Test
    fun verwirftVeraendertenInhalt() {
        val falsch = body.copyOf().also { it[it.size - 20] = (it[it.size - 20].toInt() xor 1).toByte() }
        assertThrows(GeneralSecurityException::class.java) {
            WebPushEntschluesselung.entschluesseln(
                falsch, uaPublic, authSecret, WebPushEntschluesselung.ecdhMitPrivatemSchluessel(uaPrivate),
            )
        }
    }
}
