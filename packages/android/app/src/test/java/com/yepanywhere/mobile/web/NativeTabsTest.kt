package com.yepanywhere.mobile.web

import org.junit.Assert.*
import org.junit.Test

class NativeTabsTest {
    @Test fun hostSelectionReusesButExplicitTabsHaveIndependentIdentity() {
        val tabs = NativeTabs()
        val first = tabs.open("alpha")!!
        first.path = "/projects/one/sessions/two"
        assertSame(first, tabs.open("alpha"))
        val second = tabs.open("alpha", newTab = true, foreground = false)!!
        assertNotEquals(first.id, second.id)
        assertSame(first, tabs.selected)
        tabs.select(second.id)
        assertSame(second, tabs.selected)
        assertSame(second, tabs.open("alpha"))
        assertEquals("/projects", second.path)
        tabs.close(second.id)
        assertSame(first, tabs.selected)
    }
    @Test fun restoresSelectionAndSafeRoutesWithoutCredentialsOrForgottenHosts() {
        val tabs = NativeTabs()
        tabs.open("alpha")
        val beta = tabs.open("beta", "/projects/beta")!!
        beta.path = "/projects/beta?password=secret#secret"
        assertEquals("/projects?file=one#two", NativeTabs.livePath("/projects?file=one#two"))
        val encoded = tabs.encode()
        assertFalse(encoded.contains("secret"))
        val restored = NativeTabs().apply { restore(encoded) }
        assertEquals(beta.id, restored.selectedId)
        assertEquals("/projects/beta", restored.selected?.path)
        restored.retainProfiles(setOf("alpha"))
        assertEquals("alpha", restored.selected?.profileId)
        assertEquals(1, restored.items.size)
        restored.close(restored.selectedId!!)
        assertNull(restored.selected)
    }
    @Test fun boundsTabCountAndRejectsUnsafeRestoration() {
        val tabs = NativeTabs()
        repeat(NativeTabs.MAX_TABS) { assertNotNull(tabs.open("alpha", newTab = true)) }
        assertNull(tabs.open("alpha", newTab = true))
        assertNotNull(tabs.open("alpha"))
        for (path in listOf("//example.com", "https://example.com", "/login?password=secret", "/open", "/\\host", "/bad\npath")) {
            assertEquals("/projects", NativeTabs.safePath(path))
        }
        tabs.restore("broken")
        assertTrue(tabs.items.isEmpty())
        assertNull(tabs.selectedId)
    }
}
