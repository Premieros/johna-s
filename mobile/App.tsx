import { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type DeliveryStatus = 'new' | 'accepted' | 'picked_up' | 'on_the_way' | 'delivered';

type CaptainOrder = {
  id: string;
  customer: string;
  phone: string;
  address: string;
  total: number;
  payment: 'نقدي' | 'بطاقة';
  status: DeliveryStatus;
  items: string[];
};

const statuses: Array<{ key: DeliveryStatus; label: string }> = [
  { key: 'new', label: 'جديد' },
  { key: 'accepted', label: 'مقبول' },
  { key: 'picked_up', label: 'استلام' },
  { key: 'on_the_way', label: 'في الطريق' },
  { key: 'delivered', label: 'تم التسليم' },
];

const initialOrders: CaptainOrder[] = [
  {
    id: '#1048',
    customer: 'أحمد محمد',
    phone: '0100 000 0000',
    address: 'سموحة - شارع فوزي معاذ',
    total: 485,
    payment: 'نقدي',
    status: 'new',
    items: ['2 × برجر كلاسيك', '1 × بطاطس', '2 × مشروب'],
  },
  {
    id: '#1047',
    customer: 'محمود علي',
    phone: '0111 000 0000',
    address: 'سيدي جابر - المشير أحمد إسماعيل',
    total: 320,
    payment: 'بطاقة',
    status: 'accepted',
    items: ['1 × وجبة تشيكن', '1 × كولا'],
  },
  {
    id: '#1043',
    customer: 'سارة حسن',
    phone: '0122 000 0000',
    address: 'كفر عبده - شارع الإسماعيلية',
    total: 760,
    payment: 'نقدي',
    status: 'on_the_way',
    items: ['3 × وجبة برجر', '2 × تشيكن', '3 × بطاطس'],
  },
];

function nextStatus(status: DeliveryStatus): DeliveryStatus | null {
  const index = statuses.findIndex((item) => item.key === status);
  return index >= 0 && index < statuses.length - 1 ? statuses[index + 1].key : null;
}

export default function App() {
  const [orders, setOrders] = useState(initialOrders);
  const [activeStatus, setActiveStatus] = useState<DeliveryStatus>('new');
  const [selectedOrder, setSelectedOrder] = useState<CaptainOrder | null>(null);

  const visibleOrders = useMemo(
    () => orders.filter((order) => order.status === activeStatus),
    [orders, activeStatus],
  );

  const moveOrderForward = (order: CaptainOrder) => {
    const target = nextStatus(order.status);
    if (!target) return;

    setOrders((current) =>
      current.map((item) => (item.id === order.id ? { ...item, status: target } : item)),
    );
    setSelectedOrder(null);
    setActiveStatus(target);
  };

  if (selectedOrder) {
    const target = nextStatus(selectedOrder.status);
    const targetLabel = statuses.find((item) => item.key === target)?.label;

    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <TouchableOpacity onPress={() => setSelectedOrder(null)}>
            <Text style={styles.back}>‹ رجوع للطلبات</Text>
          </TouchableOpacity>

          <View style={styles.detailCard}>
            <View style={styles.rowBetween}>
              <Text style={styles.orderId}>{selectedOrder.id}</Text>
              <Text style={styles.statusBadge}>
                {statuses.find((item) => item.key === selectedOrder.status)?.label}
              </Text>
            </View>

            <Text style={styles.customerName}>{selectedOrder.customer}</Text>
            <Text style={styles.meta}>{selectedOrder.phone}</Text>
            <Text style={styles.address}>{selectedOrder.address}</Text>

            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>تفاصيل الطلب</Text>
            {selectedOrder.items.map((item) => (
              <Text key={item} style={styles.itemText}>{item}</Text>
            ))}

            <View style={styles.divider} />
            <View style={styles.rowBetween}>
              <Text style={styles.total}>{selectedOrder.total} ج.م</Text>
              <Text style={styles.payment}>{selectedOrder.payment}</Text>
            </View>

            {target && (
              <TouchableOpacity style={styles.primaryButton} onPress={() => moveOrderForward(selectedOrder)}>
                <Text style={styles.primaryButtonText}>تغيير الحالة إلى: {targetLabel}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Johna S</Text>
            <Text style={styles.title}>تطبيق الكابتن</Text>
          </View>
          <View style={styles.onlinePill}>
            <Text style={styles.onlineText}>متصل</Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>طلبات اليوم</Text>
          <Text style={styles.summaryNumber}>{orders.length}</Text>
          <Text style={styles.summaryHint}>سيتم ربطها لاحقًا مباشرة بطلبات النظام المسندة للكابتن.</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {statuses.map((status) => {
            const count = orders.filter((order) => order.status === status.key).length;
            const active = activeStatus === status.key;
            return (
              <TouchableOpacity
                key={status.key}
                style={[styles.tab, active && styles.activeTab]}
                onPress={() => setActiveStatus(status.key)}
              >
                <Text style={[styles.tabText, active && styles.activeTabText]}>{status.label} ({count})</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.list}>
          {visibleOrders.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>لا توجد طلبات في هذه الحالة</Text>
              <Text style={styles.emptyText}>عند ربط التطبيق بالنظام ستظهر الطلبات المسندة للكابتن هنا مباشرة.</Text>
            </View>
          ) : (
            visibleOrders.map((order) => (
              <TouchableOpacity key={order.id} style={styles.orderCard} onPress={() => setSelectedOrder(order)}>
                <View style={styles.rowBetween}>
                  <Text style={styles.orderId}>{order.id}</Text>
                  <Text style={styles.totalSmall}>{order.total} ج.م</Text>
                </View>
                <Text style={styles.customerNameSmall}>{order.customer}</Text>
                <Text style={styles.addressSmall} numberOfLines={2}>{order.address}</Text>
                <View style={styles.rowBetween}>
                  <Text style={styles.paymentSmall}>{order.payment}</Text>
                  <Text style={styles.open}>فتح الطلب ›</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        <Text style={styles.previewNotice}>نسخة Captain Preview — لا تحتوي على وضع العميل.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f5f7' },
  container: { padding: 20, gap: 16, paddingBottom: 40 },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontSize: 14, fontWeight: '700', textAlign: 'right', color: '#667085' },
  title: { fontSize: 30, fontWeight: '900', textAlign: 'right', color: '#101828' },
  onlinePill: { backgroundColor: '#eaf7ef', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  onlineText: { fontWeight: '800', color: '#157347' },
  summaryCard: { backgroundColor: '#101828', borderRadius: 24, padding: 22 },
  summaryLabel: { color: '#d0d5dd', textAlign: 'right', fontSize: 15 },
  summaryNumber: { color: '#fff', textAlign: 'right', fontSize: 38, fontWeight: '900', marginVertical: 3 },
  summaryHint: { color: '#d0d5dd', textAlign: 'right', lineHeight: 21, fontSize: 13 },
  tabs: { gap: 8, paddingVertical: 2, flexDirection: 'row-reverse' },
  tab: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: '#fff' },
  activeTab: { backgroundColor: '#101828' },
  tabText: { fontWeight: '700', color: '#475467' },
  activeTabText: { color: '#fff' },
  list: { gap: 12 },
  orderCard: { backgroundColor: '#fff', borderRadius: 22, padding: 18, gap: 9 },
  rowBetween: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  orderId: { fontWeight: '900', fontSize: 18, color: '#101828' },
  totalSmall: { fontWeight: '900', fontSize: 16, color: '#101828' },
  customerNameSmall: { fontWeight: '800', fontSize: 17, textAlign: 'right', color: '#101828' },
  addressSmall: { textAlign: 'right', color: '#667085', lineHeight: 21 },
  paymentSmall: { color: '#667085', fontWeight: '700' },
  open: { fontWeight: '800', color: '#101828' },
  emptyCard: { backgroundColor: '#fff', borderRadius: 22, padding: 24, gap: 7 },
  emptyTitle: { fontWeight: '900', fontSize: 18, textAlign: 'right' },
  emptyText: { color: '#667085', lineHeight: 22, textAlign: 'right' },
  previewNotice: { textAlign: 'center', color: '#98a2b3', fontSize: 12, marginTop: 4 },
  back: { fontSize: 16, fontWeight: '800', textAlign: 'right', color: '#101828' },
  detailCard: { backgroundColor: '#fff', borderRadius: 24, padding: 22, gap: 10 },
  statusBadge: { backgroundColor: '#eef2ff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, fontWeight: '800' },
  customerName: { fontSize: 24, fontWeight: '900', textAlign: 'right', color: '#101828', marginTop: 5 },
  meta: { textAlign: 'right', color: '#667085', fontSize: 15 },
  address: { textAlign: 'right', color: '#344054', fontSize: 16, lineHeight: 24 },
  divider: { height: 1, backgroundColor: '#eaecf0', marginVertical: 7 },
  sectionTitle: { fontWeight: '900', fontSize: 17, textAlign: 'right' },
  itemText: { textAlign: 'right', color: '#475467', fontSize: 15, lineHeight: 23 },
  total: { fontSize: 24, fontWeight: '900', color: '#101828' },
  payment: { fontWeight: '800', color: '#475467' },
  primaryButton: { backgroundColor: '#101828', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18, marginTop: 10 },
  primaryButtonText: { color: '#fff', fontWeight: '900', fontSize: 16, textAlign: 'center' },
});
