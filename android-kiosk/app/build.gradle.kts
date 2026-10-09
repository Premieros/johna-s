plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseKeystore = System.getenv("KIOSK_KEYSTORE_FILE")
val hasReleaseCredentials = listOf(
    releaseKeystore,
    System.getenv("KIOSK_KEYSTORE_PASSWORD"),
    System.getenv("KIOSK_KEY_ALIAS"),
    System.getenv("KIOSK_KEY_PASSWORD"),
).all { !it.isNullOrBlank() }

android {
    namespace = "com.johnas.kiosk"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.johnas.kiosk"
        minSdk = 29
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "START_URL", "\"https://premieros.github.io/johna-s/\"")
        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        if (hasReleaseCredentials) {
            create("production") {
                storeFile = file(releaseKeystore!!)
                storePassword = System.getenv("KIOSK_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KIOSK_KEY_ALIAS")
                keyPassword = System.getenv("KIOSK_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (hasReleaseCredentials) signingConfig = signingConfigs.getByName("production")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
