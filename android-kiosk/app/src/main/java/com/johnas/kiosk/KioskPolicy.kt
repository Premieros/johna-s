package com.johnas.kiosk

import java.net.URI

/** Do not allow the embedded web app to navigate to arbitrary sites. */
object KioskPolicy {
    private const val HOST = "premieros.github.io"
    private const val BASE_PATH = "/johna-s/"

    fun isApprovedNavigation(url: String): Boolean = try {
        val parsed = URI(url)
        parsed.scheme.equals("https", ignoreCase = true) &&
            parsed.host.equals(HOST, ignoreCase = true) &&
            parsed.port == -1 &&
            parsed.userInfo == null &&
            (parsed.path == BASE_PATH || parsed.path.startsWith(BASE_PATH))
    } catch (_: Exception) {
        false
    }
}
