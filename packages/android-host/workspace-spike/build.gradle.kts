plugins { id("com.android.application") }

val machineControlRoot = providers.gradleProperty("machineControlRoot")
val machineControlNotices = layout.buildDirectory.dir("generated/machineControlNotices")
val copyMachineControlNotice = tasks.register<Copy>("copyMachineControlNotice") {
    from(machineControlRoot.map { "$it/LICENSE" })
    into(machineControlNotices)
    rename { "machine-control-LICENSE.txt" }
}
android {
    namespace = "com.yepanywhere.host.workspacespike"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.yepanywhere.host.workspace.spike"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1-spike"
        ndk { abiFilters += "arm64-v8a" }
    }
    sourceSets["main"].java.srcDir(machineControlRoot.map { "$it/platforms/android/storage/src/main/java" })
    sourceSets["main"].jniLibs.srcDir("../.local/jni")
    sourceSets["main"].assets.srcDir("../.local/notices")
    sourceSets["main"].assets.srcDir(machineControlNotices)
    packaging { jniLibs.useLegacyPackaging = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { disable += "ChromeOsAbiSupport" }
}
tasks.named("preBuild") { dependsOn(copyMachineControlNotice); doFirst {
    check(machineControlRoot.isPresent) { "Supply -PmachineControlRoot with the MC checkout" }
    check(file(machineControlRoot.get() + "/LICENSE").isFile) { "MC license notice is required" }
    check(file("../.local/jni/arm64-v8a/libproot.so").isFile) { "Prepare the host runtime first" }
} }
