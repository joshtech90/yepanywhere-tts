pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "yep-anywhere-android-host"
include(":app")

// Explicitly enabled disposable physical storage fixture; absent from normal builds.
if (providers.gradleProperty("workspaceSpike").isPresent) include(":workspace-spike")
