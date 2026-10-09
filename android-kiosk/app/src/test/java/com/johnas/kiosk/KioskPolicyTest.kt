package com.johnas.kiosk

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KioskPolicyTest {
    @Test fun siteNavigationOnly() {
        assertTrue(KioskPolicy.isApprovedNavigation("https://premieros.github.io/johna-s/"))
        assertTrue(KioskPolicy.isApprovedNavigation("https://premieros.github.io/johna-s/#/pos"))
        assertTrue(KioskPolicy.isApprovedNavigation("https://premieros.github.io/johna-s/assets/main.js"))
        assertFalse(KioskPolicy.isApprovedNavigation("http://premieros.github.io/johna-s/"))
        assertFalse(KioskPolicy.isApprovedNavigation("https://premieros.github.io/"))
        assertFalse(KioskPolicy.isApprovedNavigation("https://premieros.github.io/johna-s-malicious/"))
        assertFalse(KioskPolicy.isApprovedNavigation("https://premieros.github.io.evil.example/johna-s/"))
        assertFalse(KioskPolicy.isApprovedNavigation("https://premieros.github.io:444/johna-s/"))
        assertFalse(KioskPolicy.isApprovedNavigation("https://evil.example/johna-s/"))
        assertFalse(KioskPolicy.isApprovedNavigation("javascript:alert(1)"))
    }
}
