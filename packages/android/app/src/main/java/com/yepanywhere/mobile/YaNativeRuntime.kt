package com.yepanywhere.mobile

import android.content.Context
import com.yepanywhere.mobile.connection.YaRustProfileConnector
import com.yepanywhere.mobile.connection.YaRustTls
import com.yepanywhere.mobile.connection.YaPairingCoordinator
import com.yepanywhere.mobile.connection.YaServerConnectionManager
import com.yepanywhere.mobile.profiles.YaPairedServerStore
import com.yepanywhere.mobile.security.AndroidKeystoreSecurityClientKeyStore
import com.yepanywhere.mobile.security.YaAndroidSecurityClientDescriptorProvider
import com.yepanywhere.mobile.security.YaSecurityClientCoordinator
import java.io.Closeable
import com.yepanywhere.mobile.notifications.NativePushCoordinator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel

class YaNativeRuntime(context: Context) : Closeable {
    private val lifecycleScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val securityKeys = AndroidKeystoreSecurityClientKeyStore()
    val pairedServers = YaPairedServerStore.create(context, securityKeys = securityKeys)
    private val connector = YaRustProfileConnector(pairedServers)
    init { YaRustTls.ensure(context) }
    private val securityClients = YaSecurityClientCoordinator(
        repository = pairedServers,
        keys = securityKeys,
        descriptors = YaAndroidSecurityClientDescriptorProvider(context),
    )
    val pairing = YaPairingCoordinator(pairedServers, connector, securityClients)
    val nativePush = NativePushCoordinator(context.applicationContext, this)
    init {
        lifecycleScope.launch {
            pairedServers.listState.collect { list ->
                val profiles = list.profiles.associateBy { it.id }
                nativePush.bindings.all().forEach { binding ->
                    val profile = profiles[binding.profileId]
                    if (profile == null || profile.securityClient?.revoked == true || profile.securityClient?.clientId != binding.clientId) {
                        try { nativePush.forget(binding.profileId) }
                        catch (error: kotlinx.coroutines.CancellationException) { throw error }
                        catch (_: Exception) { /* Keep a disabled tombstone for the next explicit cleanup. */ }
                    }
                }
            }
        }
    }
    private val connectionManagers = mutableMapOf<String, YaServerConnectionManager>()

    @Synchronized
    fun connectionManager(profileId: String): YaServerConnectionManager {
        return connectionManagers.getOrPut(profileId) {
            YaServerConnectionManager(
                profileId = profileId,
                repository = pairedServers,
                connector = connector,
                securityClients = securityClients,
            )
        }
    }

    override fun close() {
        lifecycleScope.cancel()
        val managers = synchronized(this) {
            connectionManagers.values.toList().also { connectionManagers.clear() }
        }
        managers.forEach { it.close() }
        connector.close()
        pairedServers.close()
    }
}
