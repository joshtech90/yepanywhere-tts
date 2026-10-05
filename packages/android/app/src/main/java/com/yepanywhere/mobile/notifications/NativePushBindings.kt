package com.yepanywhere.mobile.notifications

import android.annotation.SuppressLint
import android.content.Context
import com.yepanywhere.mobile.BuildConfig
import java.util.UUID
import org.json.JSONObject

data class NativePushBinding(val profileId: String, val clientId: String, val installationId: String, val subscriptionId: String, val enabled: Boolean)

/** Opaque routing metadata in private, backup-disabled app storage; never a send secret. */
class NativePushBindings(context: Context, name: String = "ya_native_push_bindings_v1") {
    private val preferences = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)
    private val origin = BuildConfig.PUSH_BROKER_URL.trimEnd('/')
    @Synchronized fun all(): List<NativePushBinding> {
        return try {
            val text = preferences.getString("bindings", null) ?: return emptyList()
            check(text.length <= 32768)
            val root = JSONObject(text)
            check(root.getString("origin") == origin)
            val list = root.getJSONArray("profiles")
            check(list.length() <= 20)
            (0 until list.length()).map { index ->
                val row = list.getJSONObject(index)
                NativePushBinding(row.getString("profileId"), row.getString("clientId"), row.getString("installationId"), row.getString("subscriptionId"), row.getBoolean("enabled")).also(::validate)
            }.also { rows -> check(rows.map { it.profileId }.distinct().size == rows.size && rows.map { it.subscriptionId }.distinct().size == rows.size) }
        } catch (_: Exception) { emptyList() }
    }
    fun get(profileId: String): NativePushBinding? = all().find { it.profileId == profileId }
    @Synchronized fun put(binding: NativePushBinding) {
        validate(binding)
        val rows = all().filterNot { it.profileId == binding.profileId } + binding
        check(rows.size <= 20 && rows.map { it.subscriptionId }.distinct().size == rows.size)
        write(rows)
    }
    @Synchronized fun remove(profileId: String) {
        write(all().filterNot { it.profileId == profileId })
    }
    @SuppressLint("ApplySharedPref", "UseKtx")
    private fun write(rows: List<NativePushBinding>) {
        val values = org.json.JSONArray()
        rows.forEach { values.put(JSONObject().put("profileId", it.profileId).put("clientId", it.clientId).put("installationId", it.installationId).put("subscriptionId", it.subscriptionId).put("enabled", it.enabled)) }
        check(preferences.edit().putString("bindings", JSONObject().put("origin", origin).put("profiles", values).toString()).commit())
    }
    private fun validate(row: NativePushBinding) {
        UUID.fromString(row.profileId); UUID.fromString(row.clientId)
        check(Regex("^[A-Za-z0-9_-]{22}$").matches(row.installationId) && Regex("^[A-Za-z0-9_-]{22}$").matches(row.subscriptionId))
    }
}
