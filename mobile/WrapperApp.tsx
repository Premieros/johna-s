import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

const SYSTEM_URL = 'https://premieros.github.io/johna-s/';
const ACCENT = '#CC6600';

export default function WrapperApp() {
  const webRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF8F1" />
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.iconButton, !canGoBack && styles.disabled]}
          disabled={!canGoBack}
          onPress={() => webRef.current?.goBack()}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.titleWrap}>
          <Text style={styles.title}>Johna S</Text>
          <Text style={styles.subtitle}>النظام الكامل</Text>
        </View>

        <TouchableOpacity style={styles.iconButton} onPress={() => webRef.current?.reload()}>
          <Text style={styles.reloadText}>↻</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.webWrap}>
        <WebView
          ref={webRef}
          source={{ uri: SYSTEM_URL }}
          originWhitelist={['https://*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          onNavigationStateChange={onNavigationStateChange}
          onLoadStart={() => {
            setLoading(true);
            setError(null);
          }}
          onLoadEnd={() => setLoading(false)}
          onError={(event) => {
            setLoading(false);
            setError(event.nativeEvent.description || 'تعذر تحميل النظام');
          }}
        />

        {loading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={styles.loadingText}>جاري تحميل النظام...</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>تعذر فتح النظام</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => webRef.current?.reload()}>
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF8F1' },
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#FFF8F1',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8D8C8',
  },
  titleWrap: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#2A211B' },
  subtitle: { fontSize: 11, color: '#8A6B55', marginTop: 1 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF1E3',
    borderWidth: 1,
    borderColor: '#F1D6BC',
  },
  disabled: { opacity: 0.35 },
  backText: { fontSize: 31, lineHeight: 31, color: ACCENT, marginTop: -2 },
  reloadText: { fontSize: 22, color: ACCENT },
  webWrap: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  loadingText: { marginTop: 12, fontSize: 14, color: '#6B5545' },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#FFF8F1',
  },
  errorTitle: { fontSize: 19, fontWeight: '700', color: '#2A211B', marginBottom: 8 },
  errorText: { fontSize: 13, color: '#7A6352', textAlign: 'center', marginBottom: 18 },
  retryButton: { backgroundColor: ACCENT, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 },
  retryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
