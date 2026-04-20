# WireGuard
-keep class com.wireguard.android.backend.** { *; }
-keep class com.wireguard.crypto.** { *; }

# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.SerializationKt
-keep,includedescriptorclasses class com.antijitter.app.**$$serializer { *; }
-keepclassmembers class com.antijitter.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.antijitter.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
