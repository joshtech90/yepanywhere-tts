# Instrumentation shares the target app's Kotlin runtime. The separate test
# APK uses stdlib members that production does not, so the minified probe must
# retain that shared ABI. This rule never enters the shipping Release build.
-keep class kotlin.** { *; }
# Tests call public facade/storage and HTTP APIs not reached by the app itself.
# Preserve their shared names/signatures while optimizing private app code.
-keep,allowoptimization class com.yepanywhere.mobile.** { public protected *; }
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-keep class kotlinx.coroutines.** { *; }
