plugins { id("com.android.application") }

val machineControlRoot = providers.gradleProperty("machineControlRoot")
    .orElse(providers.provider { rootProject.file("../../../machine-control").absolutePath })
val machineControlNotices = layout.buildDirectory.dir("generated/machineControlNotices")
val copyMachineControlNotice = tasks.register<Copy>("copyMachineControlNotice") {
    from(machineControlRoot.map { "$it/LICENSE" }); into(machineControlNotices)
    rename { "machine-control-LICENSE.txt" }
}


val verifyHostRuntime by tasks.registering {
    doLast {
        for (name in listOf("libproot.so", "libproot-loader.so", "libtalloc.so", "libandroid-shmem.so")) {
            check(file("../.local/jni/arm64-v8a/$name").isFile) {
                "Prepare the verified runtime first: python3 packages/android-host/tools/host.py prepare"
            }
        }
        check(file(machineControlRoot.get() + "/platforms/android/storage/src/main/java").isDirectory) { "Supply -PmachineControlRoot with the MC checkout" }
        check(file("../.local/notices/proot-LICENSE.txt").isFile) { "Runtime license assets are required" }
    }
}
tasks.named("preBuild") { dependsOn(verifyHostRuntime, copyMachineControlNotice) }

android {
    namespace = "com.yepanywhere.host"
    compileSdk = 36
    buildFeatures { buildConfig = true }
    defaultConfig {
        applicationId = if (providers.gradleProperty("workspaceFixture").isPresent) "com.yepanywhere.host.workspace.acceptance" else "com.yepanywhere.host.experimental"
        buildConfigField("int", "HOST_PORT", if (providers.gradleProperty("workspaceFixture").isPresent) "13420" else "13400")
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-experimental"
        manifestPlaceholders["hostAdbExported"] = "false"
        ndk { abiFilters += "arm64-v8a" }
    }
    if (providers.gradleProperty("workspaceFixture").isPresent) {
        sourceSets["debug"].java.srcDir("../test/android")
        sourceSets["debug"].manifest.srcFile("../test/android/AndroidManifest.xml")
    }
    sourceSets["main"].java.srcDir(machineControlRoot.map { "$it/platforms/android/storage/src/main/java" })
    sourceSets["main"].assets.srcDir(machineControlNotices)
    sourceSets["main"].jniLibs.srcDir("../.local/jni")
    sourceSets["main"].assets.srcDir("../.local/notices")
    packaging { jniLibs.useLegacyPackaging = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        getByName("debug") { manifestPlaceholders["hostAdbExported"] = "true" }
        getByName("release") { isMinifyEnabled = false }
    }
    // This incubation payload is deliberately ARM64-only, not a ChromeOS app.
    lint { disable += "ChromeOsAbiSupport" }
}
