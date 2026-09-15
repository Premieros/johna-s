import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BaseApp from './App';
import {
  getBranches,
  getDiningTables,
  getMyOrders,
  getSessionProfile,
} from './src/gateway';
import {
  getMyShiftSummary,
  type MobileMyShiftSummary,
} from './src/operations';
import { supabase } from './src/supabase';
import type {
  DiningTableSummary,
  MobileBranch,
  MobileSessionProfile,
  WaiterOrderSummary,
} from './src/contracts';

type Language = 'ar' | 'en';

const ACCENT = '#CC6600';
const money = (value: number) => `${value.toFixed(2)} EGP`;
const paymentLabel = (method: string, language: Language) => {
  const ar: Record<string, string> = { cash: 'نقدي', card: 'بطاقة', transfer: 'تحويل', unknown: 'أخرى' };
  const en: Record<string, string> = { cash: 'Cash', card: 'Card', transfer: 'Transfer', unknown: 'Other' };
  return (language === 'ar' ? ar : en)[method] || method;
};

const labels = {
  ar: {
    menu: 'القائمة', title: 'حساب النادل', myShift: 'ملخصي في الشفت', refresh: 'تحديث', noShift: 'لا يوجد شفت مفتوح حاليًا',
    orders: 'طلباتي', openOrders: 'طلبات مفتوحة', sales: 'قيمة طلباتي', openTables: 'طاولاتي المفتوحة', branch: 'الفرع',
    language: 'اللغة', permissions: 'إجراءاتي المتاحة', discount: 'الخصم', transfer: 'النقل / الدمج', split: 'تقسيم الفاتورة',
    receipt: 'طباعة إيصال الكاشير', approvals: 'مراجعة الموافقات', allowed: 'مسموح', denied: 'غير مسموح', loading: 'جاري تحميل بياناتك...',
    emptyOrders: 'لا توجد طلبات مفتوحة تخصك', waiter: 'المستخدم', closing: 'تفاصيل إغلاقي', invoices: 'الفواتير المدفوعة', netSales: 'صافي المبيعات',
    discounts: 'الخصومات', refunds: 'المرتجعات', payments: 'طرق الدفع', products: 'المنتجات المباعة', quantity: 'الكمية', count: 'عدد العمليات', noPaidSales: 'لا توجد مبيعات مدفوعة لك في الشفت الحالي',
  },
  en: {
    menu: 'Menu', title: 'Waiter account', myShift: 'My shift summary', refresh: 'Refresh', noShift: 'No open shift right now',
    orders: 'My orders', openOrders: 'Open orders', sales: 'My order value', openTables: 'My open tables', branch: 'Branch',
    language: 'Language', permissions: 'Available actions', discount: 'Discount', transfer: 'Transfer / merge', split: 'Split bill',
    receipt: 'Cashier receipt', approvals: 'Review approvals', allowed: 'Allowed', denied: 'Not allowed', loading: 'Loading your data...',
    emptyOrders: 'You have no open orders', waiter: 'User', closing: 'My closing details', invoices: 'Paid invoices', netSales: 'Net sales',
    discounts: 'Discounts', refunds: 'Refunds', payments: 'Payment methods', products: 'Sold products', quantity: 'Qty', count: 'Transactions', noPaidSales: 'No paid sales for you in the current shift',
  },
} as const;

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState<Language>('ar');
  const [profile, setProfile] = useState<MobileSessionProfile | null>(null);
  const [branches, setBranches] = useState<MobileBranch[]>([]);
  const [summaryBranch, setSummaryBranch] = useState<MobileBranch | null>(null);
  const [summary, setSummary] = useState<MobileMyShiftSummary | null>(null);
  const [orders, setOrders] = useState<WaiterOrderSummary[]>([]);
  const [tables, setTables] = useState<DiningTableSummary[]>([]);
  const [error, setError] = useState('');

  const t = labels[language];
  const can = useCallback((permission: string) => Boolean(
    profile?.isSuperAdmin || profile?.permissions.includes(permission)
  ), [profile]);

  const loadIdentity = useCallback(async () => {
    const [nextProfile, nextBranches] = await Promise.all([getSessionProfile(), getBranches()]);
    setProfile(nextProfile);
    setBranches(nextBranches);
    setSummaryBranch((current) => {
      if (current && nextProfile.branchIds.includes(current.id)) return current;
      return nextBranches.find((item) => item.id === nextProfile.primaryBranchId)
        || nextBranches.find((item) => nextProfile.branchIds.includes(item.id))
        || nextBranches[0]
        || null;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const active = Boolean(data.session?.user?.id);
      setSessionActive(active);
      if (active) void loadIdentity().catch(() => undefined);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      const active = Boolean(session?.user?.id);
      setSessionActive(active);
      if (!active) {
        setProfile(null); setBranches([]); setSummaryBranch(null); setSummary(null); setOrders([]); setTables([]); setDrawerOpen(false);
        return;
      }
      setTimeout(() => { void loadIdentity().catch(() => undefined); }, 0);
    });

    return () => { alive = false; authListener.subscription.unsubscribe(); };
  }, [loadIdentity]);

  const loadSummary = useCallback(async () => {
    if (!summaryBranch) return;
    setLoading(true);
    setError('');
    try {
      const [nextSummary, nextOrders, nextTables] = await Promise.all([
        getMyShiftSummary(summaryBranch.id), getMyOrders(summaryBranch.id), getDiningTables(summaryBranch.id),
      ]);
      setSummary(nextSummary); setOrders(nextOrders); setTables(nextTables);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [summaryBranch]);

  useEffect(() => { if (drawerOpen && summaryBranch) void loadSummary(); }, [drawerOpen, summaryBranch, loadSummary]);

  const openOrders = useMemo(() => orders.filter((order) => order.status === 'open' || order.status === 'held'), [orders]);
  const openOrderTableIds = useMemo(() => new Set(openOrders.map((order) => order.tableId).filter((id): id is string => Boolean(id))), [openOrders]);
  const myOpenTables = useMemo(() => tables.filter((table) => openOrderTableIds.has(table.id)), [tables, openOrderTableIds]);

  const actions = [
    { key: 'discount', label: t.discount, allowed: can('pos.discount') },
    { key: 'transfer', label: t.transfer, allowed: can('pos.order.transfer') },
    { key: 'split', label: t.split, allowed: can('pos.order.split') },
    { key: 'receipt', label: t.receipt, allowed: can('pos.receipt.print') },
    { key: 'approvals', label: t.approvals, allowed: can('approvals.review') },
  ];

  return (
    <View style={styles.root}>
      <BaseApp />
      {sessionActive && (
        <TouchableOpacity style={styles.menuButton} onPress={() => setDrawerOpen(true)} accessibilityRole="button" accessibilityLabel={t.menu}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
      )}

      <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={() => setDrawerOpen(false)} />
          <SafeAreaView style={styles.drawer}>
            <ScrollView contentContainerStyle={styles.drawerContent}>
              <View style={styles.drawerHeader}>
                <TouchableOpacity style={styles.closeButton} onPress={() => setDrawerOpen(false)}><Text style={styles.closeText}>×</Text></TouchableOpacity>
                <View style={styles.identity}>
                  <Text style={styles.title}>{t.title}</Text>
                  <Text style={styles.name}>{profile?.displayName || '—'}</Text>
                  <Text style={styles.muted}>{profile?.username || ''}</Text>
                </View>
                <View style={styles.avatar}><Text style={styles.avatarText}>{profile?.displayName?.charAt(0) || 'J'}</Text></View>
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{t.branch}</Text>{loading && <ActivityIndicator size="small" color={ACCENT} />}</View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchRow}>
                  {branches.filter((item) => profile?.isSuperAdmin || profile?.branchIds.includes(item.id)).map((item) => {
                    const selected = item.id === summaryBranch?.id;
                    const branchChangeAllowed = selected || can('pos.change_branch');
                    return (
                      <TouchableOpacity key={item.id} disabled={!branchChangeAllowed} style={[styles.branchChip, selected && styles.branchChipOn, !branchChangeAllowed && styles.disabled]} onPress={() => setSummaryBranch(item)}>
                        <Text style={[styles.branchText, selected && styles.branchTextOn]}>{item.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <TouchableOpacity style={styles.refreshButton} onPress={() => void loadSummary()} disabled={loading}><Text style={styles.refreshText}>{t.refresh}</Text></TouchableOpacity>
                  <Text style={styles.sectionTitle}>{t.myShift}</Text>
                </View>
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
                {loading && !summary ? <Text style={styles.muted}>{t.loading}</Text> : null}
                {summary && !summary.shift ? <Text style={styles.muted}>{t.noShift}</Text> : null}
                <View style={styles.metrics}>
                  <Metric label={t.orders} value={String(summary?.orderCount || 0)} />
                  <Metric label={t.openOrders} value={String(summary?.openOrderCount || 0)} />
                  <Metric label={t.sales} value={money(summary?.totalOrderValue || 0)} wide />
                  <Metric label={t.openTables} value={String(myOpenTables.length)} />
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t.closing}</Text>
                <View style={styles.metrics}>
                  <Metric label={t.invoices} value={String(summary?.invoiceCount || 0)} />
                  <Metric label={t.netSales} value={money(summary?.netSales || 0)} />
                  <Metric label={t.discounts} value={money(summary?.discounts || 0)} />
                  <Metric label={t.refunds} value={money(summary?.refundedAmount || 0)} />
                </View>
                {(summary?.paymentMethods || []).length > 0 && <Text style={styles.subheading}>{t.payments}</Text>}
                {(summary?.paymentMethods || []).map((payment) => (
                  <View key={payment.method} style={styles.breakdownRow}>
                    <View><Text style={styles.breakdownValue}>{money(payment.amount)}</Text><Text style={styles.muted}>{payment.count} {t.count}</Text></View>
                    <Text style={styles.breakdownLabel}>{paymentLabel(payment.method, language)}</Text>
                  </View>
                ))}
                {(summary?.soldProducts || []).length > 0 && <Text style={styles.subheading}>{t.products}</Text>}
                {(summary?.soldProducts || []).map((product) => (
                  <View key={product.name} style={styles.breakdownRow}>
                    <Text style={styles.breakdownValue}>{product.quantity}</Text>
                    <Text style={styles.breakdownLabel}>{product.name}</Text>
                  </View>
                ))}
                {summary?.shift && (summary.paymentMethods.length === 0 && summary.soldProducts.length === 0) && <Text style={styles.muted}>{t.noPaidSales}</Text>}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t.openOrders}</Text>
                {openOrders.map((order) => (
                  <View key={order.orderId} style={styles.orderCard}>
                    <View><Text style={styles.orderTotal}>{money(order.total)}</Text><Text style={styles.status}>{order.kitchenStatus || order.status}</Text></View>
                    <View style={styles.orderCopy}><Text style={styles.orderNumber}>#{order.orderNumber} · {order.tableName}</Text><Text style={styles.muted}>{t.waiter}: {order.waiterName || profile?.displayName || '—'}</Text></View>
                  </View>
                ))}
                {!openOrders.length && <Text style={styles.muted}>{t.emptyOrders}</Text>}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t.permissions}</Text>
                {actions.map((action) => (
                  <View key={action.key} style={styles.actionRow}>
                    <Text style={[styles.permissionState, action.allowed ? styles.allowed : styles.denied]}>{action.allowed ? t.allowed : t.denied}</Text>
                    <Text style={styles.actionLabel}>{action.label}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t.language}</Text>
                <View style={styles.languageRow}>
                  <TouchableOpacity style={[styles.languageButton, language === 'en' && styles.languageButtonOn]} onPress={() => setLanguage('en')}><Text style={[styles.languageText, language === 'en' && styles.languageTextOn]}>English</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.languageButton, language === 'ar' && styles.languageButtonOn]} onPress={() => setLanguage('ar')}><Text style={[styles.languageText, language === 'ar' && styles.languageTextOn]}>العربية</Text></TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

function Metric({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <View style={[styles.metric, wide && styles.metricWide]}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  menuButton: { position: 'absolute', top: 48, left: 14, width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6DED3', alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  menuIcon: { color: ACCENT, fontSize: 22, fontWeight: '900' },
  backdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(22,18,15,0.34)' },
  dismissArea: { flex: 1 },
  drawer: { width: '88%', maxWidth: 410, backgroundColor: '#FAF8F4' },
  drawerContent: { padding: 16, paddingBottom: 36, gap: 12 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 4 },
  closeButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#F0ECE6', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#3C342E', fontSize: 25, lineHeight: 27 },
  identity: { flex: 1, alignItems: 'flex-end' },
  title: { color: '#5A514A', fontSize: 11, fontWeight: '800' },
  name: { color: '#2F2925', fontSize: 18, fontWeight: '900', textAlign: 'right' },
  avatar: { width: 45, height: 45, borderRadius: 23, backgroundColor: '#FFF1E5', borderWidth: 1, borderColor: '#F0C39D', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: ACCENT, fontWeight: '900', fontSize: 18 },
  section: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#ECE6DF', padding: 13, gap: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: '#332C27', fontSize: 15, fontWeight: '900', textAlign: 'right' },
  subheading: { color: '#5B5048', fontWeight: '900', fontSize: 12, textAlign: 'right', marginTop: 2 },
  branchRow: { gap: 7 },
  branchChip: { borderRadius: 16, backgroundColor: '#F3EFEA', borderWidth: 1, borderColor: '#E3DDD6', paddingHorizontal: 12, paddingVertical: 8 },
  branchChipOn: { backgroundColor: '#FFF2E7', borderColor: '#E5A36A' },
  branchText: { color: '#5E554E', fontWeight: '800' },
  branchTextOn: { color: ACCENT },
  disabled: { opacity: 0.4 },
  refreshButton: { borderRadius: 10, backgroundColor: '#FFF4EB', paddingHorizontal: 10, paddingVertical: 6 },
  refreshText: { color: ACCENT, fontWeight: '900', fontSize: 11 },
  metrics: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  metric: { width: '48%', minHeight: 72, borderRadius: 14, backgroundColor: '#F7F4F0', padding: 10, justifyContent: 'center', alignItems: 'flex-end' },
  metricWide: { width: '100%' },
  metricValue: { color: '#2F2925', fontSize: 17, fontWeight: '900' },
  metricLabel: { color: '#756B63', fontSize: 11, marginTop: 2, textAlign: 'right' },
  breakdownRow: { minHeight: 48, borderRadius: 12, backgroundColor: '#F8F5F1', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 10 },
  breakdownLabel: { color: '#433A34', fontWeight: '800', flex: 1, textAlign: 'right' },
  breakdownValue: { color: ACCENT, fontWeight: '900' },
  orderCard: { minHeight: 64, borderRadius: 13, backgroundColor: '#F8F5F1', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, gap: 10 },
  orderCopy: { flex: 1, alignItems: 'flex-end' },
  orderNumber: { color: '#332C27', fontWeight: '900', textAlign: 'right' },
  orderTotal: { color: ACCENT, fontWeight: '900' },
  status: { color: '#657066', fontSize: 10, textAlign: 'left' },
  actionRow: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0ECE7' },
  actionLabel: { color: '#3D3530', fontWeight: '800', textAlign: 'right' },
  permissionState: { fontSize: 10, fontWeight: '900', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden' },
  allowed: { color: '#39704F', backgroundColor: '#EAF4ED' },
  denied: { color: '#8D6258', backgroundColor: '#F4ECE9' },
  languageRow: { flexDirection: 'row', gap: 8 },
  languageButton: { flex: 1, minHeight: 42, borderRadius: 12, backgroundColor: '#F3EFEA', alignItems: 'center', justifyContent: 'center' },
  languageButtonOn: { backgroundColor: '#FFF1E5', borderWidth: 1, borderColor: '#E5A36A' },
  languageText: { color: '#645A52', fontWeight: '800' },
  languageTextOn: { color: ACCENT },
  muted: { color: '#7E746C', fontSize: 11, textAlign: 'right' },
  errorText: { color: '#9A3E31', fontWeight: '800', textAlign: 'right' },
});
