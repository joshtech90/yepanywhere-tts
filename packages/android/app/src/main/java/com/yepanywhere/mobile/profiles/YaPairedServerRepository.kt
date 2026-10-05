package com.yepanywhere.mobile.profiles

interface YaPairedServerRepository {
    suspend fun snapshot(profileId: String): YaPairedServerSnapshot?

    suspend fun upsert(
        profile: YaPairedServerProfile,
        resumeCredential: YaStoredResumeCredential? = null,
        select: Boolean = false,
    )

    /** Production storage overrides this with one protected-state mutation. */
    suspend fun updateCredential(profileId: String, resumeCredential: YaStoredResumeCredential) {
        val current = checkNotNull(snapshot(profileId)) { "Cannot store a credential for an unknown profile" }
        check(current.profile.securityClient?.revoked != true)
        upsert(current.profile, resumeCredential)
    }

    suspend fun clearCredential(profileId: String)

    suspend fun updateSecurityClientBinding(
        profileId: String,
        binding: YaSecurityClientBinding,
    ) {
        val current = checkNotNull(snapshot(profileId)) {
            "Cannot update an unknown profile"
        }
        upsert(
            profile = current.profile.copy(securityClient = binding),
            resumeCredential = current.resumeCredential,
        )
    }

    suspend fun markSecurityClientRevoked(profileId: String, clientId: String) {
        updateSecurityClientBinding(profileId, YaSecurityClientBinding.revoked(clientId))
        clearCredential(profileId)
    }

    suspend fun recordSuccessfulAuthentication(
        profileId: String,
        routeId: String,
        resumeCredential: YaStoredResumeCredential,
        connectedAtEpochMs: Long,
    )
}
