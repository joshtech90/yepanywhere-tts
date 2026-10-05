# UniFFI/JNA and Android trust verification cross a native reflection boundary.
-keep class uniffi.ya_mobile_core.** { *; }
-keep class com.yepanywhere.mobile.connection.YaRustTls { *; }
-keep,includedescriptorclasses class org.rustls.platformverifier.** { *; }
# JNA's JNI bootstrap looks up non-native Java methods by their original names.
# https://github.com/java-native-access/jna/blob/master/www/FrequentlyAskedQuestions.md#jna-on-android
-keep class com.sun.jna.** { *; }
# JNA also exposes desktop window APIs; Android cannot call that AWT surface.
-dontwarn java.awt.*
