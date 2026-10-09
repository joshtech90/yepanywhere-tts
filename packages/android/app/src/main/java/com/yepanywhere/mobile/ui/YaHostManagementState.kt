package com.yepanywhere.mobile.ui

import com.yepanywhere.mobile.connection.YaConnectionPhase
import com.yepanywhere.mobile.connection.YaConnectionState
import com.yepanywhere.mobile.profiles.YaPairedServerSnapshot
import com.yepanywhere.mobile.profiles.YaPairedServerProfile
import com.yepanywhere.mobile.profiles.YaServerRoute
import java.util.Locale
import uniffi.ya_mobile_core.CoreException

enum class YaPairingRouteKind {
    DIRECT,
    RELAY,
}

data class YaPairingInput(
    val username: String,
    val password: String,
    val routeKind: YaPairingRouteKind = YaPairingRouteKind.RELAY,
    val relayWebsocketUrl: String = "",
    val directWebsocketUrl: String = "",
)

// Keep aligned with @yep-anywhere/shared DEFAULT_RELAY_URL.
internal const val DEFAULT_RELAY_WEBSOCKET_URL = "wss://relay.yepanywhere.com/ws"

internal fun YaPairingInput.normalizedUsername(): String = when (routeKind) {
    YaPairingRouteKind.RELAY -> username.trim().lowercase(Locale.ROOT)
    YaPairingRouteKind.DIRECT -> username.trim()
}

internal fun YaPairingInput.resolveRoute(username: String): YaServerRoute = when (routeKind) {
    YaPairingRouteKind.RELAY -> YaServerRoute.relay(
        websocketUrl = relayWebsocketUrl.trim().ifEmpty { DEFAULT_RELAY_WEBSOCKET_URL },
        relayTarget = username,
    )
    YaPairingRouteKind.DIRECT -> YaServerRoute.direct(directWebsocketUrl.trim())
}

enum class YaNativeUiError {
    INVALID_SERVER_DETAILS,
    AUTHENTICATION_FAILED,
    SERVER_UNAVAILABLE,
    CONNECTION_FAILED,
    PUSH_FAILED,
    SERVER_UPDATE_REQUIRED,
}

enum class YaRemovalPromptKind {
    SERVER_RECORD_MAY_REMAIN,
    SERVER_ALREADY_UNREGISTERED,
}

data class YaRemovalPrompt(
    val profileId: String,
    val kind: YaRemovalPromptKind,
)

data class YaHostState(
    val profile: YaPairedServerProfile,
    val connection: YaConnectionState = YaConnectionState(YaConnectionPhase.IDLE),
    val pushEnabled: Boolean = false,
)

data class YaHostManagementState(
    val profiles: List<YaPairedServerProfile> = emptyList(),
    val servers: Map<String, YaHostState> = emptyMap(),
    val actionInProgress: Boolean = false,
    val error: YaNativeUiError? = null,
    val removalPrompt: YaRemovalPrompt? = null,
)

/** Authentication availability is derived afresh, never retained from rendered UI.
 * Resume temporarily removes the on-disk credential while proving its protocol
 * pin. An active source owns that transition; cancellation restores the saved
 * credential and releases the source back to idle.
 */
internal fun savedHostConnection(
    snapshot: YaPairedServerSnapshot,
    connection: YaConnectionState,
    nowEpochMs: Long,
): YaConnectionState = when {
    snapshot.profile.securityClient?.revoked == true || connection.phase == YaConnectionPhase.REVOKED -> YaConnectionState(YaConnectionPhase.REVOKED)
    connection.phase in setOf(YaConnectionPhase.CONNECTING, YaConnectionPhase.CONNECTED, YaConnectionPhase.RETRYING) -> connection
    snapshot.resumeCredential?.isEligibleAt(nowEpochMs) != true -> YaConnectionState(YaConnectionPhase.REAUTHENTICATION_REQUIRED)
    connection.phase == YaConnectionPhase.REAUTHENTICATION_REQUIRED -> YaConnectionState(YaConnectionPhase.IDLE)
    else -> connection
}

/** Connection setup failures are not evidence that the password was rejected. */
internal fun nativeHostActionError(error: Throwable): YaNativeUiError = when (error) {
    is CoreException.Unavailable, is CoreException.Timeout, is CoreException.Closed ->
        YaNativeUiError.SERVER_UNAVAILABLE
    else -> YaNativeUiError.AUTHENTICATION_FAILED
}
