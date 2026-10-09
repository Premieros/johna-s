package com.johnas.kiosk

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Best-effort fallback; the persistent HOME mapping is the primary auto-start path. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val devicePolicy = context.getSystemService(DevicePolicyManager::class.java)
        if (!devicePolicy.isDeviceOwnerApp(context.packageName) || !PinVault(context).isConfigured()) return
        runCatching {
            context.startActivity(
                Intent(context, TabletKioskActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            )
        }
    }
}
