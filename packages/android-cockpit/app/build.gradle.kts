import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Alles Maschinenbezogene kommt von build.sh: Rechneradressen aus
// "AI Worker/hosts/rollen.json", Firebase-Client aus dem privaten
// Smartzone-Projekt, Signatur von ausserhalb des Repos. Dieses Repo ist
// oeffentlich; hier stehen keine Adressen, Schluessel oder Kennungen.
fun eigenschaft(name: String): String =
    providers.gradleProperty(name).orNull?.trim().orEmpty()

fun alsJavaText(wert: String): String =
    "\"" + wert.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val signatur = Properties().apply {
    val pfad = eigenschaft("yepSignatur")
    if (pfad.isNotEmpty() && file(pfad).isFile) {
        file(pfad).inputStream().use(::load)
    }
}

android {
    namespace = "de.joscha.yepcockpit"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.joscha.yepcockpit"
        minSdk = 31
        targetSdk = 35
        versionCode = eigenschaft("yepVersionCode").toIntOrNull() ?: 1
        versionName = eigenschaft("yepVersionName").ifEmpty { "0.1" }

        buildConfigField("String", "RECHNER", alsJavaText(eigenschaft("yepRechner").ifEmpty { "[]" }))
        buildConfigField("String", "PUSH_BRUECKE", alsJavaText(eigenschaft("yepPushBruecke")))
        buildConfigField("String", "FIREBASE_APP_ID", alsJavaText(eigenschaft("yepFirebaseAppId")))
        buildConfigField("String", "FIREBASE_API_KEY", alsJavaText(eigenschaft("yepFirebaseApiKey")))
        buildConfigField("String", "FIREBASE_PROJEKT", alsJavaText(eigenschaft("yepFirebaseProjekt")))
        buildConfigField("String", "FIREBASE_SENDER", alsJavaText(eigenschaft("yepFirebaseSender")))
    }

    sourceSets {
        // Symbole erzeugt build.sh aus den zeichen.svg der Rechner.
        getByName("main").res.srcDir("src/generiert/res")
    }

    signingConfigs {
        if (signatur.isNotEmpty()) {
            create("eigen") {
                // Relative Pfade gelten ab yepSignaturBasis (Ordner der Schluesselablage).
                val basis = eigenschaft("yepSignaturBasis").ifEmpty { "." }
                storeFile = File(basis).resolve(signatur.getProperty("storeFile"))
                storePassword = signatur.getProperty("storePassword")
                keyAlias = signatur.getProperty("keyAlias")
                keyPassword = signatur.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // Gleiche Paketkennung wie Release: Firebase kennt nur diese eine.
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            if (signatur.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("eigen")
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("com.google.firebase:firebase-messaging:25.1.1")
    // Nur fuer addWebMessageListener mit Herkunftsfilter (Downloads aus der Seite).
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
}
