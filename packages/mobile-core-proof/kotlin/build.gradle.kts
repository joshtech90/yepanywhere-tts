plugins {
    kotlin("jvm") version "2.0.21"
    application
}

repositories { mavenCentral() }
dependencies { implementation("net.java.dev.jna:jna:5.17.0") }
sourceSets { main { kotlin.srcDir("src"); kotlin.srcDir(layout.buildDirectory.dir("generated")) } }
application { mainClass.set("ProofSmokeKt") }
tasks.named<JavaExec>("run") {
    systemProperty("jna.library.path", projectDir.resolve("../target/debug").canonicalPath)
    args(projectDir.resolve("../../..").canonicalPath, projectDir.resolve("..").canonicalPath)
}
