package com.yepanywhere.mobile.notifications

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.content.Context
import androidx.core.content.edit
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativePushBindingsInstrumentedTest {
    @Test fun savedMappingsAreBoundedAndInstallationSecretsCannotCrossOrigins() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "native-push-test-${UUID.randomUUID()}"
        val alias = "native-push-test-key-${UUID.randomUUID()}"
        val bindings = NativePushBindings(context, name)
        val first = NativePushBinding(UUID.randomUUID().toString(), UUID.randomUUID().toString(), "a".repeat(22), "b".repeat(22), true)
        val second = first.copy(profileId = UUID.randomUUID().toString(), subscriptionId = "c".repeat(22))
        val store = BrokerInstallationStore(context, "$name-secret", alias, "https://original.test")
        try {
            bindings.put(first); bindings.put(second)
            assertEquals(2, bindings.all().size)
            bindings.put(first.copy(enabled = false))
            assertFalse(checkNotNull(bindings.get(first.profileId)).enabled)
            assertTrue(checkNotNull(bindings.get(second.profileId)).enabled)
            assertThrows(Exception::class.java) { bindings.put(first.copy(subscriptionId = "../bad")) }
            bindings.remove(first.profileId)
            assertNull(bindings.get(first.profileId)); assertNotNull(bindings.get(second.profileId))
            store.write(BrokerInstallationRecord("a".repeat(22), "s".repeat(43), "d".repeat(64), true))
            assertNotNull(store.read())
            assertFalse(checkNotNull(store.encryptedEnvelopeForTest()).contains("s".repeat(43)))
            val otherOrigin = BrokerInstallationStore(context, "$name-secret", alias, "https://other.test")
            assertNull(otherOrigin.read())
        } finally {
            context.getSharedPreferences(name, Context.MODE_PRIVATE).edit(commit = true) { clear() }
            store.destroyTestState()
        }
    }
}
