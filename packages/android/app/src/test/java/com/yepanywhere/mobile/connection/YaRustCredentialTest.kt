package com.yepanywhere.mobile.connection

import org.json.JSONObject
import com.yepanywhere.mobile.profiles.*
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test

class YaRustCredentialTest {
    @Test fun conversionPreservesExistingKeySessionAndDowngradePin() {
        val original = YaResumeCredential("saved-owner", "existing-session", ByteArray(32) { (255 - it).toByte() }, 7)
        val bytes = YaRustCredential.encode(original)
        val value = JSONObject(bytes.toString(Charsets.UTF_8))
        assertEquals(255, value.getJSONArray("base_key").getInt(0))
        assertEquals(7, value.getInt("resume_protocol_version"))
        assertEquals(original, YaRustCredential.decode(bytes))
        assertTrue(bytes.all { it == 0.toByte() })
    }
    @Test fun nativePersistenceCannotRecreateForgottenOrRevokedProfiles() {
        val profile = YaPairedServerProfile.create("Fixture", "saved-owner", YaServerRoute.direct("wss://fixture.invalid/api/ws"), 1)
        val credential = YaResumeCredential(profile.username, "fixture-session", ByteArray(32), 4)
        val stored = YaStoredResumeCredential(credential, 1, null)
        var snapshot: YaPairedServerSnapshot? = null
        val repository = object : YaPairedServerRepository {
            override suspend fun snapshot(profileId: String) = snapshot
            override suspend fun upsert(profile: YaPairedServerProfile, resumeCredential: YaStoredResumeCredential?, select: Boolean) { snapshot = YaPairedServerSnapshot(profile, resumeCredential) }
            override suspend fun clearCredential(profileId: String) { snapshot = snapshot?.copy(resumeCredential = null) }
            override suspend fun recordSuccessfulAuthentication(profileId: String, routeId: String, resumeCredential: YaStoredResumeCredential, connectedAtEpochMs: Long) { error("Unexpected route update") }
        }
        val persistence = YaRustCredentialPersistence(repository, profile, stored, pairing = true)
        assertTrue(persistence.persist(YaRustCredential.encode(credential)))
        assertNotNull(snapshot)
        snapshot = null
        assertFalse(persistence.persist(YaRustCredential.encode(credential)))
        assertNull(snapshot)
        snapshot = YaPairedServerSnapshot(profile.copy(securityClient = YaSecurityClientBinding.revoked(UUID.randomUUID().toString())), null)
        assertFalse(persistence.beginResume())
        assertFalse(persistence.persist(YaRustCredential.encode(credential)))
        assertNull(snapshot?.resumeCredential)
    }
    @Test fun conversionRejectsMalformedNativeCredentials() {
        val original = YaResumeCredential("saved-owner", "existing-session", ByteArray(32), 4)
        val malformed = JSONObject(YaRustCredential.encode(original).toString(Charsets.UTF_8))
        malformed.getJSONArray("base_key").put(0, 256)
        val bytes = malformed.toString().toByteArray()
        assertThrows(IllegalArgumentException::class.java) { YaRustCredential.decode(bytes) }
        assertTrue(bytes.all { it == 0.toByte() })
    }
}
