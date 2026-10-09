package com.johnas.kiosk

import android.content.Context
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** No default PIN; PBKDF2 digest stored in app-private, non-backed-up preferences. */
class PinVault(context: Context) {
    private val prefs = context.getSharedPreferences("johnas_admin", Context.MODE_PRIVATE)

    fun isConfigured(): Boolean =
        prefs.contains("salt") && prefs.contains("digest")

    fun save(pin: String) {
        require(pin.matches(Regex("[0-9]{6,12}")))
        val salt = ByteArray(24).also { SecureRandom().nextBytes(it) }
        val digest = derive(pin, salt)
        check(prefs.edit().putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
            .putString("digest", Base64.encodeToString(digest, Base64.NO_WRAP)).commit())
    }

    fun matches(pin: String): Boolean {
        if (!isConfigured() || !pin.matches(Regex("[0-9]{6,12}"))) return false
        return try {
            val salt = Base64.decode(prefs.getString("salt", ""), Base64.NO_WRAP)
            val expected = Base64.decode(prefs.getString("digest", ""), Base64.NO_WRAP)
            MessageDigest.isEqual(expected, derive(pin, salt))
        } catch (_: Exception) {
            false
        }
    }

    private fun derive(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, 210_000, 256)
        return try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded }
        finally { spec.clearPassword() }
    }
}
