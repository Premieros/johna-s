package com.johnas.kiosk

import android.app.Activity
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Dedicated-device WebView wrapper. It cannot become Device Owner by itself;
 * onboarding must provision this app as owner on a fresh Android device.
 */
class TabletKioskActivity : Activity() {
    private val dpm by lazy { getSystemService(DevicePolicyManager::class.java) }
    private val admin by lazy { ComponentName(this, KioskAdminReceiver::class.java) }
    private val pinVault by lazy { PinVault(this) }
    private var kioskExitApproved = false
    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        immersive()
        when {
            !dpm.isDeviceOwnerApp(packageName) -> showProvisioningRequired()
            !pinVault.isConfigured() -> showSetAdminPin()
            else -> showWebApp()
        }
    }

    override fun onResume() {
        super.onResume()
        if (dpm.isDeviceOwnerApp(packageName) && pinVault.isConfigured() &&
            !kioskExitApproved && webView != null) {
            applyDevicePolicyAndStartLock()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }

    private fun immersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        )
    }

    private fun showProvisioningRequired() {
        showMessage(
            "تهيئة تابلت جوناس",
            "التطبيق لم يُعيَّن Device Owner بعد. لا يوجد قفل حقيقي في هذه الحالة. " +
                "ثبّت نسخة موقعة بتوقيع دائم على الجهاز الجديد، ثم استخدم Android Enterprise provisioning " +
                "أو أمر ADB الموضح في دليل المشروع قبل أي تشغيل للموظفين."
        )
    }

    private fun showMessage(title: String, message: String) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(30, 30, 30, 30)
        }
        box.addView(TextView(this).apply {
            text = title; textSize = 23f; setTextColor(Color.BLACK)
        })
        box.addView(TextView(this).apply {
            text = message; textSize = 16f; setTextColor(Color.DKGRAY)
            setPadding(0, 22, 0, 0)
        })
        setContentView(box)
    }

    private fun pinField(hint: String) = EditText(this).apply {
        this.hint = hint
        inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
    }

    private fun showSetAdminPin() {
        val first = pinField("رمز المدير (6–12 رقمًا)")
        val again = pinField("تأكيد الرمز")
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(35, 25, 35, 25)
            addView(first)
            addView(again)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("تعيين رمز المدير قبل قفل التابلت")
            .setMessage("احفظ هذا الرمز في مكان آمن. لا يوجد رمز افتراضي أو باب خلفي.")
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton("تفعيل جوناس", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val pin = first.text.toString()
                if (!pin.matches(Regex("[0-9]{6,12}")) || pin != again.text.toString()) {
                    first.error = "أدخل 6 إلى 12 رقمًا متطابقًا"
                } else {
                    pinVault.save(pin)
                    dialog.dismiss()
                    showWebApp()
                }
            }
        }
        dialog.show()
    }

    private fun showWebApp() {
        val frame = FrameLayout(this)
        val web = WebView(this)
        webView = web
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.javaScriptCanOpenWindowsAutomatically = false
        web.settings.setSupportMultipleWindows(false)
        web.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        android.webkit.CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val allow = KioskPolicy.isApprovedNavigation(request.url.toString())
                if (!allow) Toast.makeText(this@TabletKioskActivity, "رابط خارج جوناس محظور", Toast.LENGTH_SHORT).show()
                return !allow
            }
        }
        frame.addView(web, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))

        // Accessible Wi-Fi only; long-press is the administrator entrance.
        val wifiButton = Button(this).apply {
            text = "Wi-Fi"
            contentDescription = "إعدادات Wi-Fi. اضغط مطولًا لإدخال رمز المدير"
            setOnClickListener { showWifiPanel() }
            setOnLongClickListener { requestAdminExit(); true }
        }
        val lp = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP or Gravity.END
        ).apply { setMargins(8, 12, 12, 8) }
        frame.addView(wifiButton, lp)
        setContentView(frame)
        web.loadUrl(BuildConfig.START_URL)
        applyDevicePolicyAndStartLock()
    }

    private fun applyDevicePolicyAndStartLock() {
        if (!dpm.isDeviceOwnerApp(packageName) || !pinVault.isConfigured()) return
        runCatching {
            val home = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.setLockTaskPackages(admin, arrayOf(packageName))
            dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
            dpm.addPersistentPreferredActivity(admin, home, ComponentName(this, TabletKioskActivity::class.java))
            dpm.setKeyguardDisabled(admin, true)
            startLockTask()
        }.onFailure {
            Toast.makeText(this, "تعذّر تفعيل قفل الجهاز: ${it.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun showWifiPanel() {
        // Do NOT whitelist the whole Settings application; it permits roaming
        // to unrestricted settings. Test this System Wi-Fi panel on the exact tablet.
        try {
            startActivity(Intent(Settings.Panel.ACTION_WIFI))
        } catch (_: Exception) {
            AlertDialog.Builder(this)
                .setTitle("Wi-Fi غير متاح")
                .setMessage("لو لوحة Wi-Fi محظورة في وضع القفل على هذا الإصدار، يلزم اختبار إعداد المصنع وإعداد إدارة الجهاز. لن نفتح كل إعدادات أندرويد.")
                .setPositiveButton("حسنًا", null)
                .show()
        }
    }

    private fun requestAdminExit() {
        val field = pinField("رمز المدير")
        val dialog = AlertDialog.Builder(this)
            .setTitle("الخروج من وضع جوناس")
            .setView(field)
            .setNegativeButton("إلغاء", null)
            .setPositiveButton("فك القفل", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (!pinVault.matches(field.text.toString())) {
                    field.error = "رمز غير صحيح"
                } else {
                    dialog.dismiss()
                    unlockWithAdminPermission()
                }
            }
        }
        dialog.show()
    }

    private fun unlockWithAdminPermission() {
        kioskExitApproved = true
        runCatching { stopLockTask() }
        runCatching { dpm.clearPackagePersistentPreferredActivities(admin, packageName) }
        runCatching { dpm.setLockTaskPackages(admin, emptyArray()) }
        runCatching { dpm.setKeyguardDisabled(admin, false) }
        Toast.makeText(this, "تم فك قفل الجهاز بواسطة المدير", Toast.LENGTH_LONG).show()
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))
        finish()
    }

    @Deprecated("Android back navigation is owned by the WebView inside the kiosk.")
    override fun onBackPressed() {
        val web = webView
        if (web != null && web.canGoBack()) web.goBack()
        // Never finish the activity from Back while in kiosk.
    }

    override fun onDestroy() {
        webView?.apply {
            stopLoading()
            destroy()
        }
        webView = null
        super.onDestroy()
    }
}
