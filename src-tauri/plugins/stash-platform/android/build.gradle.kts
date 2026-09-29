import groovy.json.JsonSlurper

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "local.stash.platform"
    compileSdk = 36
    defaultConfig { minSdk = 24; consumerProguardFiles("consumer-rules.pro") }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
}
dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.appcompat:appcompat:1.6.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    implementation(project(":tauri-android"))
}

// Resolve the JVM certificate verifier from the exact Rust dependency in Cargo.lock.
val cargoMetadata = providers.exec {
    commandLine("cargo", "metadata", "--format-version", "1", "--filter-platform", "aarch64-linux-android", "--manifest-path", file("../../../Cargo.toml").absolutePath)
}.standardOutput.asText.get()
val packages = (JsonSlurper().parseText(cargoMetadata) as Map<*, *>)["packages"] as List<Map<String, Any>>
val verifier = packages.first { it["name"] == "rustls-platform-verifier-android" }
rootProject.allprojects {
    repositories { maven { url = uri(File(verifier["manifest_path"] as String).parentFile.resolve("maven")); metadataSources { artifact() } } }
}
dependencies { implementation("rustls:rustls-platform-verifier:${verifier["version"]}@aar") }
