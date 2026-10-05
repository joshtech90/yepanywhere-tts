package com.yepanywhere.mobile.connection

class YaResumeCredential(
    val username: String,
    val sessionId: String,
    baseKey: ByteArray,
    val resumeProtocolVersion: Int,
) {
    private val baseKeyBytes = baseKey.copyOf()

    val keySize: Int
        get() = baseKeyBytes.size

    init {
        require(username.isNotBlank())
        require(sessionId.isNotBlank())
        require(baseKeyBytes.size == 32)
        require(resumeProtocolVersion >= 3)
    }

    internal fun copyBaseKey(): ByteArray = baseKeyBytes.copyOf()

    override fun equals(other: Any?): Boolean {
        return other is YaResumeCredential &&
            username == other.username &&
            sessionId == other.sessionId &&
            baseKeyBytes.contentEquals(other.baseKeyBytes) &&
            resumeProtocolVersion == other.resumeProtocolVersion
    }

    override fun hashCode(): Int {
        var result = username.hashCode()
        result = 31 * result + sessionId.hashCode()
        result = 31 * result + baseKeyBytes.contentHashCode()
        result = 31 * result + resumeProtocolVersion
        return result
    }
}


class YaResumeRejectedException(val reason: String) :
    IllegalStateException("Native resume credential rejected: $reason")
