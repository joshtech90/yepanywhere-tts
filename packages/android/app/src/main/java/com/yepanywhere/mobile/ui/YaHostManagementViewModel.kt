package com.yepanywhere.mobile.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.yepanywhere.mobile.YepAnywhereApplication
import com.yepanywhere.mobile.profiles.YaServerRemovalCoordinator
import com.yepanywhere.mobile.profiles.YaServerRemovalOutcome
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import com.yepanywhere.mobile.notifications.NativePushFailure

/** Observes saved hosts and connection status without acquiring dashboard leases. */
class YaHostManagementViewModel(application: Application) : AndroidViewModel(application) {
    private val runtime = (application as YepAnywhereApplication).nativeRuntime
    private val store = runtime.pairedServers
    private val mutableState = MutableStateFlow(YaHostManagementState())
    private val mutableOpenProfile = MutableSharedFlow<String>(extraBufferCapacity = 1)
    private val observers = mutableMapOf<String, Job>()
    private val removal = YaServerRemovalCoordinator(store::forget)
    val state = mutableState.asStateFlow()
    val openProfile = mutableOpenProfile.asSharedFlow()

    init {
        viewModelScope.launch {
            store.listState.collect { list ->
                val snapshots = store.snapshots().associateBy { it.profile.id }
                mutableState.value = mutableState.value.copy(
                    profiles = list.profiles,
                    servers = list.profiles.mapNotNull { profile ->
                        val snapshot = snapshots[profile.id] ?: return@mapNotNull null
                        profile.id to YaHostState(snapshot.profile,
                            savedHostConnection(snapshot, runtime.connectionManager(profile.id).state.value, System.currentTimeMillis()),
                            runtime.nativePush.enabled(profile.id))
                    }.toMap(),
                )
                observers.keys.filter { id -> list.profiles.none { it.id == id } }.forEach { observers.remove(it)?.cancel() }
                list.profiles.forEach { profile ->
                    if (profile.id !in observers) observers[profile.id] = launch {
                        runtime.connectionManager(profile.id).state.collect connectionState@ {
                            val snapshot = store.snapshot(profile.id) ?: return@connectionState
                            val source = mutableState.value.servers[profile.id] ?: return@connectionState
                            mutableState.value = mutableState.value.copy(
                                servers = mutableState.value.servers + (profile.id to source.copy(
                                    profile = snapshot.profile,
                                    connection = savedHostConnection(snapshot, runtime.connectionManager(profile.id).state.value, System.currentTimeMillis()),
                                )),
                            )
                        }
                    }
                }
            }
        }
    }

    fun select(profileId: String) = action {
        val snapshot = checkNotNull(store.snapshot(profileId))
        if (snapshot.profile.securityClient?.revoked == true) error("Pair the revoked device again")
        store.select(profileId)
        mutableOpenProfile.emit(profileId)
    }

    fun pair(input: YaPairingInput) = action {
        val username = input.normalizedUsername()
        if (username.isBlank() || input.password.isEmpty()) {
            mutableState.value = mutableState.value.copy(error = YaNativeUiError.INVALID_SERVER_DETAILS)
            return@action
        }
        val route = try { input.resolveRoute(username) } catch (_: IllegalArgumentException) {
            mutableState.value = mutableState.value.copy(error = YaNativeUiError.INVALID_SERVER_DETAILS)
            return@action
        }
        val profile = runtime.pairing.pair(username, username, input.password, route)
        mutableOpenProfile.emit(profile.id)
    }

    fun reauthenticate(profileId: String, password: String) = action {
        runtime.pairing.reauthenticate(profileId, password)
        store.select(profileId)
        mutableOpenProfile.emit(profileId)
    }

    fun removeProfile(profileId: String) = action {
        val profile = store.snapshot(profileId)?.profile ?: return@action
        val result = removal.remove(profile) { clientId ->
            val lease = runtime.connectionManager(profileId).acquire()
            try { lease.request("DELETE", "/security/clients/$clientId") }
            finally { lease.releaseAndAwait() }
        }
        showRemovalResult(profileId, result)
    }
    fun forgetAnyway(profileId: String) = action { showRemovalResult(profileId, removal.forgetAnyway(profileId)) }
    fun clearRemovalPrompt() { mutableState.value = mutableState.value.copy(removalPrompt = null) }
    fun clearError() { mutableState.value = mutableState.value.copy(error = null) }
    fun setPush(profileId: String, enabled: Boolean) = pushAction(profileId) {
        if (enabled) runtime.nativePush.enable(profileId) else runtime.nativePush.disable(profileId)
    }
    fun testPush(profileId: String) = pushAction(profileId) { runtime.nativePush.test(profileId) }
    private fun pushAction(profileId: String, operation: suspend () -> Unit) {
        if (mutableState.value.actionInProgress) return
        mutableState.value = mutableState.value.copy(actionInProgress = true, error = null)
        viewModelScope.launch {
            try { operation() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { mutableState.value = mutableState.value.copy(error = if ((error as? NativePushFailure)?.reason == "server_update_required") YaNativeUiError.SERVER_UPDATE_REQUIRED else YaNativeUiError.PUSH_FAILED) }
            finally {
                val source = mutableState.value.servers[profileId]
                mutableState.value = mutableState.value.copy(actionInProgress = false, servers = if (source == null) mutableState.value.servers else mutableState.value.servers + (profileId to source.copy(pushEnabled = runtime.nativePush.enabled(profileId))))
            }
        }
    }

    private fun showRemovalResult(profileId: String, result: YaServerRemovalOutcome) {
        mutableState.value = mutableState.value.copy(removalPrompt = when (result) {
            YaServerRemovalOutcome.COMPLETE -> null
            YaServerRemovalOutcome.NEEDS_FORGET_ANYWAY -> YaRemovalPrompt(profileId, YaRemovalPromptKind.SERVER_RECORD_MAY_REMAIN)
            YaServerRemovalOutcome.NEEDS_LOCAL_CLEANUP -> YaRemovalPrompt(profileId, YaRemovalPromptKind.SERVER_ALREADY_UNREGISTERED)
        })
    }

    private fun action(block: suspend () -> Unit) {
        if (mutableState.value.actionInProgress) return
        mutableState.value = mutableState.value.copy(actionInProgress = true, error = null)
        viewModelScope.launch {
            try { block() }
            catch (error: CancellationException) { throw error }
            catch (error: Throwable) { mutableState.value = mutableState.value.copy(error = nativeHostActionError(error)) }
            finally { mutableState.value = mutableState.value.copy(actionInProgress = false) }
        }
    }
}
