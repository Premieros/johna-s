import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const activity = readFileSync(
  'android-kiosk/app/src/main/java/com/johnas/kiosk/TabletKioskActivity.kt',
  'utf8',
);

describe('Android kiosk manager Wi-Fi maintenance contract', () => {
  it('does not launch HOME during manager unlock (avoids immediate kiosk relaunch)', () => {
    expect(activity).toContain('private fun unlockWithAdminPermission()');
    expect(activity).toContain('showAdminMaintenance()');
    expect(activity).not.toMatch(/startActivity\(Intent\(Intent\.ACTION_MAIN\)\.addCategory\(Intent\.CATEGORY_HOME\)\)/);
  });

  it('requires manager PIN before Wi-Fi settings and explicit manager re-lock', () => {
    expect(activity).toContain('if (!pinVault.matches(field.text.toString()))');
    expect(activity).toContain('runCatching { stopLockTask() }');
    expect(activity).toContain('kioskExitApproved = true');
    expect(activity).toContain('startActivity(Intent(Settings.ACTION_WIFI_SETTINGS))');
    expect(activity).toContain('kioskExitApproved = false');
    expect(activity).toContain('showWebApp()');
  });

  it('does not allowlist unrestricted Settings during normal kiosk', () => {
    expect(activity).toContain('dpm.setLockTaskPackages(admin, arrayOf(packageName))');
    expect(activity).not.toContain('com.android.settings');
  });
});
