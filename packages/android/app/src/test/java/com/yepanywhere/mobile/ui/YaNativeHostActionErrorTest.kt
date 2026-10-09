package com.yepanywhere.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import uniffi.ya_mobile_core.CoreException

class YaNativeHostActionErrorTest {
    @Test fun transportFailuresDoNotAccuseCredentials() {
        for (error in listOf(CoreException.Unavailable(), CoreException.Timeout(), CoreException.Closed())) {
            assertEquals(YaNativeUiError.SERVER_UNAVAILABLE, nativeHostActionError(error))
        }
    }

    @Test fun authenticationAndVerificationFailuresRemainDistinctFromAnOutage() {
        for (error in listOf(CoreException.ReauthenticationRequired(), CoreException.InvalidMessage())) {
            assertEquals(YaNativeUiError.AUTHENTICATION_FAILED, nativeHostActionError(error))
        }
    }
}
