package com.yepanywhere.mobile.notifications

import android.content.Context
import com.yepanywhere.mobile.BuildConfig
import com.yepanywhere.mobile.YaNativeRuntime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

class NativePushFailure(val reason: String) : Exception(reason)

class NativePushCoordinator(private val context: Context, private val runtime: YaNativeRuntime) {
    val bindings = NativePushBindings(context)
    private val mutex = Mutex()
    private val broker = PushBrokerClient(BuildConfig.PUSH_BROKER_URL)
    private val installations = NotificationFoundation.installationStore(context)
    suspend fun enabled(profileId: String): Boolean {
        val profile = runtime.pairedServers.snapshot(profileId)?.profile ?: return false
        val binding = bindings.get(profileId) ?: return false
        return binding.enabled && profile.securityClient?.revoked != true && profile.securityClient?.clientId == binding.clientId && installations.read()?.installationId == binding.installationId
    }
    suspend fun enable(profileId: String) = mutex.withLock {
        val status = NotificationStatusReader(context, installations).read()
        if (!BuildConfig.FIREBASE_CONFIGURED || !status.notificationsEnabled) throw NativePushFailure("permission_required")
        val lease = runtime.connectionManager(profileId).acquire()
        try {
            val version = lease.request("GET", "/version").body as? JSONObject ?: throw NativePushFailure("server_update_required")
            val capabilities = version.optJSONArray("capabilities")
            if (capabilities == null || (0 until capabilities.length()).none { capabilities.optString(it) == "native-push-subscriptions-v1" }) throw NativePushFailure("server_update_required")
            val advertised = version.optJSONObject("nativePush") ?: throw NativePushFailure("server_update_required")
            if (advertised.optInt("protocolVersion") != 1 || advertised.optString("brokerUrl").trimEnd('/') != BuildConfig.PUSH_BROKER_URL.trimEnd('/')) throw NativePushFailure("broker_mismatch")
            val client = runtime.pairedServers.snapshot(profileId)?.profile?.securityClient
            val clientId = client?.clientId ?: throw NativePushFailure("server_update_required")
            if (client.revoked) throw NativePushFailure("revoked")
            val installation = installations.read()?.takeIf { it.targetCurrent } ?: throw NativePushFailure("registration_pending")
            val credentials = BrokerInstallationCredentials(installation.installationId, installation.installationSecret)
            if (enabled(profileId)) return@withLock
            bindings.get(profileId)?.let {
                if (!withContext(Dispatchers.IO) { cleanup(it) }) throw NativePushFailure("cleanup_pending")
            }
            val created = withContext(Dispatchers.IO) { broker.createSubscription(credentials) } ?: throw NativePushFailure("broker_unavailable")
            val binding = NativePushBinding(profileId, clientId, installation.installationId, created.subscriptionId, false)
            try {
                // Persist a disabled destination before transferring the send capability.
                withContext(Dispatchers.IO) { bindings.put(binding) }
                val body = JSONObject().put("subscriptionId", created.subscriptionId).put("sendSecret", created.sendSecret).put("privacyMode", "generic")
                check(lease.request("PUT", "/security/clients/$clientId/native-push-subscription", body).status == 200)
                val current = runtime.pairedServers.snapshot(profileId)?.profile?.securityClient
                check(current?.clientId == clientId && !current.revoked && installations.read()?.installationId == installation.installationId)
                withContext(Dispatchers.IO) { bindings.put(binding.copy(enabled = true)) }
            } catch (error: Throwable) {
                withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) {
                    try { cleanup(binding) } catch (_: Exception) { broker.deleteSubscription(credentials, created.subscriptionId) }
                }
                throw error
            }
        } finally { withContext(kotlinx.coroutines.NonCancellable) { lease.releaseAndAwait() } }
    }
    suspend fun disable(profileId: String) = mutex.withLock {
        val binding = bindings.get(profileId) ?: return@withLock
        // Retire local routing immediately, even when the host is offline.
        withContext(Dispatchers.IO) { bindings.put(binding.copy(enabled = false)) }
        val removed = withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) { cleanup(binding) }
        var serverFailure: Throwable? = null
        val lease = runtime.connectionManager(profileId).acquire()
        try { lease.request("DELETE", "/security/clients/${binding.clientId}/native-push-subscription") }
        catch (error: Throwable) { serverFailure = error }
        finally { withContext(kotlinx.coroutines.NonCancellable) { lease.releaseAndAwait() } }
        if (!removed && serverFailure != null) throw NativePushFailure("disable_pending")
    }
    suspend fun test(profileId: String) = mutex.withLock {
        val binding = bindings.get(profileId)?.takeIf { it.enabled } ?: throw NativePushFailure("not_enrolled")
        val lease = runtime.connectionManager(profileId).acquire()
        try { check(lease.request("POST", "/security/clients/${binding.clientId}/native-push-subscription/test").status == 202) }
        catch (error: com.yepanywhere.mobile.connection.YaApiException) {
            val code = (error.response.body as? JSONObject)?.optString("code")
            if (code in setOf("native_push_invalid_subscription", "native_push_not_enrolled")) withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) { cleanup(binding) }
            throw error
        }
        finally { withContext(kotlinx.coroutines.NonCancellable) { lease.releaseAndAwait() } }
    }
    suspend fun forget(profileId: String) = mutex.withLock {
        bindings.get(profileId)?.let { binding -> withContext(Dispatchers.IO) { cleanup(binding) } }
    }
    private fun cleanup(binding: NativePushBinding): Boolean {
        bindings.put(binding.copy(enabled = false))
        val installation = installations.read()
        val removed = installation == null || installation.installationId != binding.installationId || broker.deleteSubscription(BrokerInstallationCredentials(installation.installationId, installation.installationSecret), binding.subscriptionId)
        if (removed) bindings.remove(binding.profileId)
        return removed
    }
}
