package com.yepanywhere.mobile.notifications

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.ArrayDeque
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class PushBrokerClientTest {
    @Test
    fun createsAndReplacesAnInstallationWithTheExactBrokerContract() {
        val createConnection = FakeConnection(
            status = HttpURLConnection.HTTP_CREATED,
            responseBody = JSONObject()
                .put("installationId", CREDENTIALS.installationId)
                .put("installationSecret", CREDENTIALS.installationSecret)
                .toString(),
        )
        val replaceConnection = FakeConnection(
            status = HttpURLConnection.HTTP_NO_CONTENT,
        )
        val connections = ArrayDeque(listOf(createConnection, replaceConnection))
        val requestedUrls = mutableListOf<URL>()
        val client = PushBrokerClient("https://push.example/") { url ->
            requestedUrls += url
            connections.removeFirst()
        }

        assertEquals(
            CreateInstallationResult.Created(CREDENTIALS),
            client.createInstallation("first-fid"),
        )
        assertEquals(
            ReplaceInstallationTargetResult.UPDATED,
            client.replaceInstallationTarget(CREDENTIALS, "second-fid"),
        )

        assertEquals("https://push.example/v1/installations", requestedUrls[0].toString())
        assertEquals("POST", createConnection.requestMethod)
        assertFalse(createConnection.instanceFollowRedirects)
        assertEquals(null, createConnection.requestProperties["Authorization"])
        assertEquals(
            "first-fid",
            JSONObject(createConnection.requestBody()).getJSONObject("target").getString("value"),
        )

        assertEquals(
            "https://push.example/v1/installations/${CREDENTIALS.installationId}/target",
            requestedUrls[1].toString(),
        )
        assertEquals("PUT", replaceConnection.requestMethod)
        assertEquals(
            listOf("Bearer ${CREDENTIALS.installationSecret}"),
            replaceConnection.requestProperties["Authorization"],
        )
        assertEquals(
            "second-fid",
            JSONObject(replaceConnection.requestBody()).getJSONObject("target").getString("value"),
        )
    }

    @Test
    fun rejectsInsecureEndpointsRedirectsAndMalformedCredentials() {
        assertThrows(IllegalArgumentException::class.java) {
            PushBrokerClient("http://push.example/")
        }

        val redirect = PushBrokerClient("https://push.example/") {
            FakeConnection(HttpURLConnection.HTTP_MOVED_TEMP)
        }
        assertEquals(CreateInstallationResult.Failed, redirect.createInstallation("fid"))

        val malformed = PushBrokerClient("https://push.example/") {
            FakeConnection(
                HttpURLConnection.HTTP_CREATED,
                JSONObject()
                    .put("installationId", "short")
                    .put("installationSecret", "short")
                    .toString(),
            )
        }
        assertEquals(CreateInstallationResult.Failed, malformed.createInstallation("fid"))
    }

    @Test
    fun classifiesOnlyAnExactNotFoundAsAStaleCapability() {
        val notFound = PushBrokerClient("https://push.example/") {
            FakeConnection(HttpURLConnection.HTTP_NOT_FOUND)
        }
        assertEquals(
            ReplaceInstallationTargetResult.NOT_FOUND,
            notFound.replaceInstallationTarget(CREDENTIALS, "fid"),
        )

        val unavailable = PushBrokerClient("https://push.example/") {
            FakeConnection(HttpURLConnection.HTTP_UNAVAILABLE)
        }
        assertEquals(
            ReplaceInstallationTargetResult.FAILED,
            unavailable.replaceInstallationTarget(CREDENTIALS, "fid"),
        )
    }

    @Test
    fun subscriptionManagementIsBoundedAndUsesOnlyInstallationAuthority() {
        val id = "c".repeat(22)
        val create = FakeConnection(201, JSONObject().put("subscriptionId", id).put("sendSecret", "d".repeat(43)).toString())
        val missing = FakeConnection(404)
        val queue = ArrayDeque(listOf(create, missing))
        val urls = mutableListOf<URL>()
        val broker = PushBrokerClient("https://push.example/") { url -> urls += url; queue.removeFirst() }
        assertEquals(id, broker.createSubscription(CREDENTIALS)?.subscriptionId)
        assertEquals(listOf("Bearer ${CREDENTIALS.installationSecret}"), create.requestProperties["Authorization"])
        assertEquals("{}", create.requestBody())
        assertFalse(create.instanceFollowRedirects)
        assertEquals(true, broker.deleteSubscription(CREDENTIALS, id))
        assertEquals("DELETE", missing.requestMethod)
        assertEquals("https://push.example/v1/installations/${CREDENTIALS.installationId}/subscriptions/$id", urls.last().toString())
        for (body in listOf(" ".repeat(8193), "{}", JSONObject().put("subscriptionId", id).put("sendSecret", "d".repeat(43)).put("unexpected", true).toString())) {
            val malformed = PushBrokerClient("https://push.example/") { FakeConnection(201, body) }
            assertEquals(null, malformed.createSubscription(CREDENTIALS))
        }
        val redirect = PushBrokerClient("https://push.example/") { FakeConnection(302) }
        assertEquals(null, redirect.createSubscription(CREDENTIALS))
        assertEquals(false, redirect.deleteSubscription(CREDENTIALS, id))
    }

    private class FakeConnection(
        private val status: Int,
        private val responseBody: String? = null,
    ) : HttpURLConnection(URL("https://push.example/")) {
        private val output = ByteArrayOutputStream()

        override fun connect() = Unit
        override fun disconnect() = Unit
        override fun usingProxy(): Boolean = false
        override fun getResponseCode(): Int = status
        override fun getInputStream(): InputStream {
            return ByteArrayInputStream(checkNotNull(responseBody).toByteArray())
        }

        override fun getOutputStream(): OutputStream = output

        fun requestBody(): String = output.toString(Charsets.UTF_8.name())
    }

    companion object {
        private val CREDENTIALS = BrokerInstallationCredentials(
            installationId = "a".repeat(22),
            installationSecret = "b".repeat(43),
        )
    }
}
