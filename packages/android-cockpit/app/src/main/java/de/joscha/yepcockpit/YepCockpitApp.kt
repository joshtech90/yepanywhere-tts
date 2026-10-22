package de.joscha.yepcockpit

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

class YepCockpitApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Kein google-services.json im oeffentlichen Repo: build.sh reicht die
        // Werte des Firebase-Clients als BuildConfig herein.
        if (Push.eingerichtet && FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(
                this,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJEKT)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER)
                    .build(),
            )
        }
        Meldungen.kanaeleAnlegen(this)
    }
}
