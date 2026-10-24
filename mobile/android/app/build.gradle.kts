import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Firebase / Google Services
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

// Release signing is driven by android/key.properties (git-ignored).
// The keystore file itself is also git-ignored — never commit either.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

// Read every value without assuming its type: a partial or malformed
// key.properties must produce the actionable guard error below, not a
// `TypeCastException` while Gradle configures the project.
fun signingProperty(key: String): String? =
    (keystoreProperties[key] as? String)?.trim()?.takeIf { it.isNotEmpty() }

val releaseStoreFile = signingProperty("storeFile")
val releaseStorePassword = signingProperty("storePassword")
val releaseKeyAlias = signingProperty("keyAlias")
val releaseKeyPassword = signingProperty("keyPassword")
val hasCompleteReleaseSigning =
    releaseStoreFile != null &&
        releaseStorePassword != null &&
        releaseKeyAlias != null &&
        releaseKeyPassword != null

android {
    namespace = "com.finpro.app.finpro_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.finpro.app.finpro_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        // Only define a release config when all four values are present.
        if (hasCompleteReleaseSigning) {
            create("release") {
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = releaseStorePassword
            }
        }
    }

    buildTypes {
        release {
            // Sign with the real release key when it is fully configured. When
            // it is not, `signingConfig` stays null and the release build fails
            // in `gradle.taskGraph.whenReady` below with an actionable message,
            // instead of silently shipping a debug-signed artifact.
            if (hasCompleteReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

flutter {
    source = "../.."
}

// Fail fast on release builds when the signing material is missing or
// incomplete. Previously a missing `key.properties` fell back to the debug
// key, which produces a store-rejected, non-upgradable release artifact.
// Debug, profile and test builds never trigger this check.
gradle.taskGraph.whenReady {
    val isReleaseBuild = allTasks.any { it.name.contains("Release") }
    if (!isReleaseBuild) return@whenReady

    val requiredKeys = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")

    if (!keystorePropertiesFile.exists()) {
        throw GradleException(
            "Release build requested but android/key.properties is missing. " +
                "Create it with storeFile, storePassword, keyAlias and " +
                "keyPassword, then place the keystore at the path given by " +
                "storeFile (resolved relative to the android/ directory). " +
                "Debug and test builds are unaffected."
        )
    }

    val missingKeys = requiredKeys.filter { signingProperty(it) == null }
    if (missingKeys.isNotEmpty()) {
        throw GradleException(
            "android/key.properties is incomplete; missing or blank: " +
                missingKeys.joinToString(", ") +
                ". Release signing cannot proceed."
        )
    }

    val storeFile = rootProject.file(releaseStoreFile!!)
    if (!storeFile.exists()) {
        throw GradleException(
            "The release keystore was not found at ${storeFile.absolutePath}. " +
                "Check the storeFile path in android/key.properties."
        )
    }
}
