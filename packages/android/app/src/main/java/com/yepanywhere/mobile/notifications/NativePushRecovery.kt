package com.yepanywhere.mobile.notifications

import com.yepanywhere.mobile.connection.YaConnectionState
import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.connection.YaConnectionUnavailableException
import com.yepanywhere.mobile.connection.YaNativeOperationException
import com.yepanywhere.mobile.connection.YaNativeOperationFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.transformLatest

/** Observe the existing foreground recovery owner; never start a retry timer here. */
@OptIn(ExperimentalCoroutinesApi::class)
internal suspend fun <T : Any> resolveNativePushWhenReady(
    states: StateFlow<YaConnectionState>,
    resolve: suspend () -> T?,
): T? = states.transformLatest { state ->
    when {
        state.phase == YaConnectionPhase.CONNECTED -> {
            try {
                emit(resolve())
            } catch (error: CancellationException) {
                throw error
            } catch (_: YaConnectionUnavailableException) {
                // A ready connection can disappear during the authenticated lookup.
            } catch (error: YaNativeOperationException) {
                if (error.failure != YaNativeOperationFailure.CONNECTION_UNAVAILABLE) emit(null)
            } catch (_: Exception) {
                // A server rejection or invalid destination is not connectivity churn.
                emit(null)
            }
        }
        state.phase in setOf(YaConnectionPhase.REVOKED, YaConnectionPhase.REAUTHENTICATION_REQUIRED) ||
            (state.phase == YaConnectionPhase.FAILED && !state.recoverable) -> emit(null)
    }
}.first()
