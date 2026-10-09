package com.yepanywhere.mobile.notifications

import com.yepanywhere.mobile.connection.YaApiException
import com.yepanywhere.mobile.connection.YaApiResponse
import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.connection.YaConnectionState
import com.yepanywhere.mobile.connection.YaConnectionUnavailableException
import com.yepanywhere.mobile.connection.YaNativeOperationException
import com.yepanywhere.mobile.connection.YaNativeOperationFailure
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativePushRecoveryTest {
    @Test
    fun anOfflineTapWaitsThroughExhaustionForTheExistingOwnerToRecover() = runBlocking {
        val states = MutableStateFlow(YaConnectionState(YaConnectionPhase.RETRYING))
        var lookups = 0
        val result = async(Dispatchers.Unconfined) {
            resolveNativePushWhenReady(states) { lookups++; "/projects/p/sessions/s" }
        }
        try {
            assertTrue(result.isActive)
            assertEquals(0, lookups)
            states.value = YaConnectionState(YaConnectionPhase.FAILED, recoverable = true)
            assertTrue(result.isActive)
            assertEquals(0, lookups)
            states.value = YaConnectionState(YaConnectionPhase.CONNECTED)
            assertEquals("/projects/p/sessions/s", result.await())
            assertEquals(1, lookups)
        } finally { result.cancelAndJoin() }
        assertEquals(0, states.subscriptionCount.value)
    }

    @Test
    fun disconnectCancelsAnOldLookupBeforeTheNextReadyGeneration() = runBlocking {
        val states = MutableStateFlow(YaConnectionState(YaConnectionPhase.CONNECTED))
        val pending = CompletableDeferred<String>()
        var cancelled = false
        var lookups = 0
        val result = async(Dispatchers.Unconfined) {
            resolveNativePushWhenReady(states) {
                if (++lookups == 1) try { pending.await() } finally { cancelled = true }
                else "new destination"
            }
        }
        try {
            states.value = YaConnectionState(YaConnectionPhase.RETRYING)
            assertTrue(cancelled)
            assertTrue(result.isActive)
            states.value = YaConnectionState(YaConnectionPhase.CONNECTED)
            assertEquals("new destination", result.await())
            assertEquals(2, lookups)
        } finally { result.cancelAndJoin() }
    }

    @Test
    fun typedConnectionFailuresKeepTheTapPendingWithoutSpinning() = runBlocking {
        for (failure in listOf(
            YaConnectionUnavailableException("connection lost"),
            YaNativeOperationException(YaNativeOperationFailure.CONNECTION_UNAVAILABLE),
        )) {
            val states = MutableStateFlow(YaConnectionState(YaConnectionPhase.CONNECTED))
            var lookups = 0
            val result = async(Dispatchers.Unconfined) {
                resolveNativePushWhenReady(states) { if (++lookups == 1) throw failure else "destination" }
            }
            try {
                assertTrue(result.isActive)
                assertEquals(1, lookups)
                states.value = YaConnectionState(YaConnectionPhase.RETRYING)
                states.value = YaConnectionState(YaConnectionPhase.CONNECTED)
                assertEquals("destination", result.await())
                assertEquals(2, lookups)
            } finally { result.cancelAndJoin() }
        }
    }

    @Test
    fun terminalAuthenticationAndVerificationFailuresDoNotOpenADestination() = runBlocking {
        for (phase in listOf(YaConnectionPhase.REVOKED, YaConnectionPhase.REAUTHENTICATION_REQUIRED, YaConnectionPhase.FAILED)) {
            val states = MutableStateFlow(YaConnectionState(phase))
            var lookups = 0
            assertNull(resolveNativePushWhenReady(states) { lookups++; "forbidden" })
            assertEquals(0, lookups)
        }
    }

    @Test
    fun revocationCancelsAnInFlightDestinationLookup() = runBlocking {
        val states = MutableStateFlow(YaConnectionState(YaConnectionPhase.CONNECTED))
        var cancelled = false
        val pending = CompletableDeferred<String>()
        val result = async(Dispatchers.Unconfined) {
            resolveNativePushWhenReady(states) { try { pending.await() } finally { cancelled = true } }
        }
        try {
            states.value = YaConnectionState(YaConnectionPhase.REVOKED)
            assertNull(result.await())
            assertTrue(cancelled)
            pending.complete("late forbidden path")
            assertEquals(0, states.subscriptionCount.value)
        } finally { result.cancelAndJoin() }
    }

    @Test
    fun aServerRejectionOrRetiredBindingEndsTheAction() = runBlocking {
        val states = MutableStateFlow(YaConnectionState(YaConnectionPhase.CONNECTED))
        assertNull(resolveNativePushWhenReady(states) { throw YaApiException(YaApiResponse(403, emptyMap(), null)) })
        assertNull(resolveNativePushWhenReady<String>(states) { null })
    }

    @Test
    fun backgroundOrSupersedingTapCancellationReleasesTheObserver() = runBlocking {
        val states = MutableStateFlow(YaConnectionState(YaConnectionPhase.RETRYING))
        var opened = false
        val result = async(Dispatchers.Unconfined) {
            resolveNativePushWhenReady(states) { opened = true; "destination" }
        }
        result.cancelAndJoin()
        states.value = YaConnectionState(YaConnectionPhase.CONNECTED)
        assertFalse(opened)
        assertEquals(0, states.subscriptionCount.value)
    }
}
