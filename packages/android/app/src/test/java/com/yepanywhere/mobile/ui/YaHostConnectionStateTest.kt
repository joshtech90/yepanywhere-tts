package com.yepanywhere.mobile.ui

import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.connection.YaConnectionState
import com.yepanywhere.mobile.connection.YaResumeCredential
import com.yepanywhere.mobile.profiles.*
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.UUID

class YaHostConnectionStateTest {
    private val profile = YaPairedServerProfile.create("Fixture", "fixture-owner", YaServerRoute.direct("wss://fixture.invalid/api/ws"), 1)
    private val credential = YaStoredResumeCredential(YaResumeCredential(profile.username, "fixture-session", ByteArray(32), 3), 1, null)
    private val saved = YaPairedServerSnapshot(profile, credential)
    private fun phase(snapshot: YaPairedServerSnapshot, phase: YaConnectionPhase, now: Long = 2) =
        savedHostConnection(snapshot, YaConnectionState(phase), now).phase

    @Test fun resumeAndCancellationReconcileSavedCredentialAvailability() {
        val pending = saved.copy(resumeCredential = null)
        for (active in listOf(YaConnectionPhase.CONNECTING, YaConnectionPhase.RETRYING, YaConnectionPhase.CONNECTED)) {
            assertEquals(active, phase(pending, active))
        }
        assertEquals(YaConnectionPhase.REAUTHENTICATION_REQUIRED, phase(pending, YaConnectionPhase.IDLE))
        assertEquals(YaConnectionPhase.IDLE, phase(saved, YaConnectionPhase.IDLE))
        assertEquals(YaConnectionPhase.IDLE, phase(saved, YaConnectionPhase.REAUTHENTICATION_REQUIRED))
    }
    @Test fun realExpiryMissingCredentialAndRevocationStillRequireRecovery() {
        assertEquals(YaConnectionPhase.REAUTHENTICATION_REQUIRED, phase(saved, YaConnectionPhase.IDLE, YaStoredResumeCredential.IDLE_TIMEOUT_MS + 2))
        assertEquals(YaConnectionPhase.REAUTHENTICATION_REQUIRED, phase(saved.copy(resumeCredential = null), YaConnectionPhase.REAUTHENTICATION_REQUIRED))
        assertEquals(YaConnectionPhase.REVOKED, phase(saved, YaConnectionPhase.REVOKED))
        val revoked = saved.copy(profile = profile.copy(securityClient = YaSecurityClientBinding.revoked(UUID.randomUUID().toString())))
        assertEquals(YaConnectionPhase.REVOKED, phase(revoked, YaConnectionPhase.CONNECTED))
        assertEquals(YaConnectionPhase.REVOKED, phase(revoked, YaConnectionPhase.IDLE))
    }
    @Test fun preservesNetworkFailureAndLiveConnectionDetails() {
        val retry = YaConnectionState(YaConnectionPhase.RETRYING, retryAttempt = 2, errorMessage = "Network unavailable")
        assertEquals(retry, savedHostConnection(saved.copy(resumeCredential = null), retry, 2))
        assertEquals(YaConnectionPhase.FAILED, phase(saved, YaConnectionPhase.FAILED))
    }
}
