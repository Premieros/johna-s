package com.johnas.kiosk

import android.app.admin.DeviceAdminReceiver

/** Android Device Owner component; never silently enrolls itself. */
class KioskAdminReceiver : DeviceAdminReceiver()
