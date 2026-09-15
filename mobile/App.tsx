import { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type Permission =
  | 'pos.view'
  | 'pos.order.create'
  | 'pos.order.edit'
  | 'pos.send_kitchen'
  | 'pos.payment.take'
  | 'pos.order.split'
  | 'pos.order.transfer'
  | 'approvals.view';

type Screen = 'login' | 'tables' | 'menu' | 'cart' | 'orders' | 'permissions';
type TableStatus = 'available' | 'occupied';

type DiningTable = {
  id: number;
  name: string;
  area: string;
  status: TableStatus;
  guestCount?: number;
  waiterName?: string;
};

type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
};

type CartLine = MenuItem & { quantity: number; notes?: string };

type StaffProfile = {
  name: string;
  title: string;
  permissions: Permission[];
};

const profiles: StaffProfile[] = [
  {
    name: 'أحمد محمد',
    title: 'نادل الصالة',
    permissions: ['pos.view', 'pos.order.create', 'pos.order.edit', 'pos.send_kitchen'],
  },
  {
    name: 'محمد علي',
    title: 'مدير الفرع',
    permissions: [
      'pos.view',
      'pos.order.create',
      'pos.order.edit',
      'pos.send_kitchen',
      'pos.payment.take',
      'pos.order.split',
      'pos.order.transfer',
      'approvals.view',
    ],
  },
];

const tables: DiningTable[] = [
  { id: 1, name: 'طاولة 1', area: 'الصالة الرئيسية', status: 'available' },
  { id: 2, name: 'طاولة 2', area: 'الصالة الرئيسية', status: 'occupied', guestCount: 3, waiterName: 'أحمد محمد' },
  { id: 3, name: 'طاولة 3', area: 'الصالة الرئيسية', status: 'available' },
  { id: 4, name: 'طاولة 4', area: 'الصالة الرئيسية', status: 'available' },
  { id: 5, name: 'طاولة 5', area: 'الصالة الرئيسية', status: 'occupied', guestCount: 2, waiterName: 'محمود حسن' },
  { id: 6, name: 'طاولة 6', area: 'الصالة الرئيسية', status: 'available' },
  { id: 7, name: 'طاولة 7', area: 'الصالة الرئيسية', status: 'available' },
  { id: 8, name: 'طاولة 8', area: 'الصالة الرئيسية', status: 'available' },
  { id: 9, name: 'طاولة 9', area: 'الصالة الرئيسية', status: 'occupied', guestCount: 4, waiterName: 'أحمد محمد' },
];

const menuItems: MenuItem[] = [
  { id: 'p1', name: 'برجر كلاسيك', category: 'البرجر', price: 165, description: 'برجر لحم، جبنة، خس وصوص خاص' },
  { id: 'p2', name: 'تشيكن كريسبي', category: 'الدجاج', price: 145, description: 'دجاج مقرمش مع صوص Johna S' },
  { id: 'p3', name: 'بطاطس', category: 'الإضافات', price: 55, description: 'بطاطس مقلية مقرمشة' },
  { id: 'p4', name: 'كولا', category: 'المشروبات', price: 35, description: 'مشروب غازي' },
  { id: 'p5', name: 'عصير برتقال', category: 'المشروبات', price: 60, description: 'عصير برتقال طازج' },
];

const permissionLabels: Record<Permission, string> = {
  'pos.view': 'عرض نقطة البيع',
  'pos.order.create': 'إنشاء طلب',
  'pos.order.edit': 'تعديل الطلب',
  'pos.send_kitchen': 'إرسال للمطبخ',
  'pos.payment.take': 'تحصيل / دفع',
  'pos.order.split': 'تقسيم الفاتورة',
  'pos.order.transfer': 'نقل الطلب / الطاولة',
  'approvals.view': 'عرض الموافقات',
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [profile, setProfile] = useState<StaffProfile>(profiles[0]!);
  const [selectedTable, setSelectedTable] = useState<DiningTable | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');

  const can = (permission: Permission) => profile.permissions.includes(permission);
  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const filteredMenu = useMemo(
    () => menuItems.filter((item) => item.name.includes(query) || item.category.includes(query)),
    [query],
  );

  const addItem = (item: MenuItem) => {
    if (!can('pos.order.create')) return;
    setCart((current) => {
      const existing = current.find((line) => line.id === item.id);
      if (existing) return current.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { ...item, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    if (!can('pos.order.edit')) return;
    setCart((current) => current
      .map((line) => line.id === id ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line)
      .filter((line) => line.quantity > 0));
  };

  if (screen === 'login') {
    return (
      <SafeAreaView style={styles.loginSafe}>
        <View style={styles.loginWrap}>
          <Text style={styles.logo}>Johna S</Text>
          <Text style={styles.loginTitle}>نظام طلبات نادل الصالة</Text>
          <Text style={styles.loginHint}>نسخة تصميم مستقلة — لا تتصل بالنظام أو قاعدة البيانات حاليًا</Text>

          <View style={styles.loginCard}>
            <Text style={styles.label}>اختر مستخدم المعاينة</Text>
            {profiles.map((item) => (
              <TouchableOpacity
                key={item.title}
                style={[styles.profileOption, profile.title === item.title && styles.profileOptionActive]}
                onPress={() => setProfile(item)}
              >
                <View>
                  <Text style={styles.profileName}>{item.name}</Text>
                  <Text style={styles.profileTitle}>{item.title}</Text>
                </View>
                <Text style={styles.permissionCount}>{item.permissions.length} صلاحيات</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.goldButton} onPress={() => setScreen('tables')}>
              <Text style={styles.goldButtonText}>دخول التطبيق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const Header = ({ title }: { title: string }) => (
    <View style={styles.header}>
      <View style={styles.userBlock}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{profile.name.charAt(0)}</Text></View>
        <View>
          <Text style={styles.headerUser}>{profile.name}</Text>
          <Text style={styles.headerRole}>{profile.title}</Text>
        </View>
      </View>
      <View style={styles.titleBlock}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.online}>● متصل</Text>
      </View>
    </View>
  );

  if (screen === 'permissions') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title="صلاحياتي" />
          <View style={styles.permissionHero}>
            <Text style={styles.permissionHeroTitle}>{profile.title}</Text>
            <Text style={styles.permissionHeroText}>التطبيق يعرض الوظائف حسب الصلاحيات الفعلية للمستخدم عند الربط لاحقًا.</Text>
          </View>
          <View style={styles.permissionList}>
            {(Object.keys(permissionLabels) as Permission[]).map((permission) => {
              const enabled = can(permission);
              return (
                <View key={permission} style={styles.permissionRow}>
                  <Text style={[styles.permissionState, enabled ? styles.allowed : styles.denied]}>{enabled ? 'مسموح' : 'غير مسموح'}</Text>
                  <Text style={styles.permissionText}>{permissionLabels[permission]}</Text>
                </View>
              );
            })}
          </View>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('tables')}>
            <Text style={styles.secondaryButtonText}>العودة للطاولات</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'menu') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title={selectedTable?.name ?? 'المنيو'} />
          <View style={styles.tableContext}>
            <Text style={styles.tableContextMain}>{selectedTable?.name}</Text>
            <Text style={styles.tableContextSub}>{selectedTable?.area}</Text>
          </View>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="ابحث عن صنف..."
            textAlign="right"
          />
          <View style={styles.menuList}>
            {filteredMenu.map((item) => (
              <View key={item.id} style={styles.menuCard}>
                <TouchableOpacity style={styles.addButton} onPress={() => addItem(item)} disabled={!can('pos.order.create')}>
                  <Text style={styles.addButtonText}>{can('pos.order.create') ? '+' : '×'}</Text>
                </TouchableOpacity>
                <View style={styles.menuInfo}>
                  <Text style={styles.menuName}>{item.name}</Text>
                  <Text style={styles.menuDesc}>{item.description}</Text>
                  <Text style={styles.menuPrice}>{item.price} ج.م</Text>
                </View>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.cartBar} onPress={() => setScreen('cart')}>
            <Text style={styles.cartBarTotal}>{total} ج.م</Text>
            <Text style={styles.cartBarText}>السلة ({cart.reduce((n, line) => n + line.quantity, 0)})</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'cart') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title="مراجعة الطلب" />
          <View style={styles.tableContext}>
            <Text style={styles.tableContextMain}>{selectedTable?.name}</Text>
            <Text style={styles.tableContextSub}>طلب جديد</Text>
          </View>
          {cart.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyTitle}>السلة فارغة</Text></View>
          ) : cart.map((line) => (
            <View key={line.id} style={styles.cartLine}>
              <View style={styles.qtyControls}>
                <TouchableOpacity style={styles.qtyButton} onPress={() => updateQty(line.id, -1)}><Text>−</Text></TouchableOpacity>
                <Text style={styles.qtyText}>{line.quantity}</Text>
                <TouchableOpacity style={styles.qtyButton} onPress={() => updateQty(line.id, 1)}><Text>+</Text></TouchableOpacity>
              </View>
              <View style={styles.cartInfo}>
                <Text style={styles.cartName}>{line.name}</Text>
                <Text style={styles.cartPrice}>{line.price * line.quantity} ج.م</Text>
              </View>
            </View>
          ))}
          <View style={styles.totalCard}>
            <Text style={styles.totalValue}>{total} ج.م</Text>
            <Text style={styles.totalLabel}>إجمالي الطلب</Text>
          </View>
          {can('pos.send_kitchen') ? (
            <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen('orders')} disabled={cart.length === 0}>
              <Text style={styles.primaryButtonText}>إرسال الطلب للمطبخ</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.blockedBox}><Text style={styles.blockedText}>لا تملك صلاحية الإرسال للمطبخ</Text></View>
          )}
          {can('pos.payment.take') && (
            <TouchableOpacity style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>تحصيل / دفع</Text></TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setScreen('menu')}><Text style={styles.textLink}>إضافة أصناف أخرى</Text></TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'orders') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title="طلباتي" />
          <View style={styles.orderSuccess}>
            <Text style={styles.successMark}>✓</Text>
            <Text style={styles.successTitle}>تم إرسال الطلب للمطبخ</Text>
            <Text style={styles.successOrder}>#1024</Text>
            <Text style={styles.successSub}>{selectedTable?.name} • باسم {profile.name}</Text>
          </View>
          <View style={styles.orderCard}>
            <Text style={styles.orderStatus}>قيد التحضير</Text>
            <Text style={styles.orderNumber}>#1024</Text>
            <Text style={styles.orderMeta}>{selectedTable?.name} • {cart.reduce((n, line) => n + line.quantity, 0)} أصناف</Text>
            <Text style={styles.orderOwner}>النادل: {profile.name}</Text>
          </View>
          <View style={styles.managerActions}>
            {can('pos.order.transfer') && <TouchableOpacity style={styles.smallAction}><Text style={styles.smallActionText}>نقل الطاولة</Text></TouchableOpacity>}
            {can('pos.order.split') && <TouchableOpacity style={styles.smallAction}><Text style={styles.smallActionText}>تقسيم الفاتورة</Text></TouchableOpacity>}
            {can('approvals.view') && <TouchableOpacity style={styles.smallAction}><Text style={styles.smallActionText}>الموافقات</Text></TouchableOpacity>}
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={() => { setCart([]); setSelectedTable(null); setScreen('tables'); }}>
            <Text style={styles.primaryButtonText}>العودة للطاولات</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Header title="اختيار الطاولة" />
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.permissionsButton} onPress={() => setScreen('permissions')}>
            <Text style={styles.permissionsButtonText}>صلاحياتي ({profile.permissions.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={() => setScreen('login')}>
            <Text style={styles.logoutText}>تغيير المستخدم</Text>
          </TouchableOpacity>
        </View>
        {!can('pos.view') ? (
          <View style={styles.blockedBox}><Text style={styles.blockedText}>هذا المستخدم لا يملك صلاحية عرض نقطة البيع.</Text></View>
        ) : (
          <>
            <View style={styles.areaTabs}>
              <View style={styles.areaTabActive}><Text style={styles.areaTabActiveText}>الصالة الرئيسية</Text></View>
              <View style={styles.areaTab}><Text style={styles.areaTabText}>الصالة الخارجية</Text></View>
              <View style={styles.areaTab}><Text style={styles.areaTabText}>VIP</Text></View>
            </View>
            <View style={styles.tableGrid}>
              {tables.map((table) => (
                <TouchableOpacity
                  key={table.id}
                  style={[styles.tableCard, table.status === 'occupied' && styles.tableOccupied]}
                  onPress={() => {
                    if (!can('pos.order.create')) return;
                    setSelectedTable(table);
                    setCart([]);
                    setScreen('menu');
                  }}
                >
                  <Text style={styles.tableIcon}>◉</Text>
                  <Text style={styles.tableNumber}>{table.id}</Text>
                  <Text style={[styles.tableStatus, table.status === 'occupied' && styles.tableStatusOccupied]}>
                    {table.status === 'available' ? 'متاحة' : 'مشغولة'}
                  </Text>
                  {table.waiterName && <Text style={styles.tableOwner}>{table.waiterName}</Text>}
                  {table.guestCount && <Text style={styles.guestCount}>{table.guestCount} ضيوف</Text>}
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const green = '#0c5b3d';
const darkGreen = '#06452f';
const cream = '#f7f3ea';
const gold = '#e8c76b';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: cream },
  loginSafe: { flex: 1, backgroundColor: darkGreen },
  loginWrap: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  logo: { color: gold, fontSize: 44, fontWeight: '900', textAlign: 'center', letterSpacing: 1 },
  loginTitle: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  loginHint: { color: '#d6e4dc', textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  loginCard: { backgroundColor: '#fff', borderRadius: 28, padding: 18, gap: 12 },
  label: { textAlign: 'right', fontWeight: '900', color: '#1f2937' },
  profileOption: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 18, padding: 15, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  profileOptionActive: { borderColor: green, backgroundColor: '#eef8f3' },
  profileName: { textAlign: 'right', fontWeight: '900', fontSize: 16 },
  profileTitle: { textAlign: 'right', color: '#667085', marginTop: 3 },
  permissionCount: { color: green, fontWeight: '800' },
  goldButton: { backgroundColor: gold, borderRadius: 16, paddingVertical: 15, marginTop: 6 },
  goldButtonText: { color: '#1f2937', textAlign: 'center', fontWeight: '900', fontSize: 16 },
  container: { padding: 18, gap: 14, paddingBottom: 40 },
  header: { backgroundColor: darkGreen, borderRadius: 22, padding: 16, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  userBlock: { flexDirection: 'row-reverse', gap: 10, alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e6f0ea', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: green, fontWeight: '900', fontSize: 20 },
  headerUser: { color: '#fff', fontWeight: '900', textAlign: 'right' },
  headerRole: { color: '#c9ded4', textAlign: 'right', fontSize: 12 },
  titleBlock: { alignItems: 'flex-start' },
  headerTitle: { color: '#fff', fontWeight: '900', fontSize: 19, textAlign: 'right' },
  online: { color: '#8ae0b1', fontSize: 12, marginTop: 4 },
  toolbar: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: 10 },
  permissionsButton: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12 },
  permissionsButtonText: { color: green, textAlign: 'center', fontWeight: '900' },
  logoutButton: { backgroundColor: '#fff', borderRadius: 14, padding: 12 },
  logoutText: { color: '#667085', fontWeight: '800' },
  areaTabs: { flexDirection: 'row-reverse', gap: 8 },
  areaTabActive: { backgroundColor: green, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 10 },
  areaTabActiveText: { color: '#fff', fontWeight: '900' },
  areaTab: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 15, paddingVertical: 10 },
  areaTabText: { color: '#667085', fontWeight: '800' },
  tableGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  tableCard: { width: '31%', minHeight: 142, backgroundColor: '#fff', borderRadius: 20, padding: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dfe7e2' },
  tableOccupied: { backgroundColor: '#fff0ef', borderColor: '#efb4ae' },
  tableIcon: { color: green, fontSize: 22, fontWeight: '900' },
  tableNumber: { fontSize: 25, fontWeight: '900', marginTop: 4 },
  tableStatus: { color: green, fontWeight: '900', marginTop: 4 },
  tableStatusOccupied: { color: '#c24135' },
  tableOwner: { fontSize: 10, color: '#667085', marginTop: 5, textAlign: 'center' },
  guestCount: { fontSize: 10, color: '#667085', marginTop: 2 },
  tableContext: { backgroundColor: '#fff', borderRadius: 18, padding: 15 },
  tableContextMain: { textAlign: 'right', fontSize: 21, fontWeight: '900' },
  tableContextSub: { textAlign: 'right', color: '#667085', marginTop: 3 },
  search: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, fontSize: 15 },
  menuList: { gap: 10 },
  menuCard: { backgroundColor: '#fff', borderRadius: 20, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 14 },
  addButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: green, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#fff', fontSize: 25, fontWeight: '900' },
  menuInfo: { flex: 1 },
  menuName: { textAlign: 'right', fontWeight: '900', fontSize: 17 },
  menuDesc: { textAlign: 'right', color: '#667085', marginTop: 4, lineHeight: 19 },
  menuPrice: { textAlign: 'right', color: green, fontWeight: '900', marginTop: 5 },
  cartBar: { backgroundColor: green, borderRadius: 18, padding: 16, flexDirection: 'row', justifyContent: 'space-between' },
  cartBarText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  cartBarTotal: { color: '#fff', fontWeight: '900', fontSize: 16 },
  cartLine: { backgroundColor: '#fff', borderRadius: 18, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#eef4f0', alignItems: 'center', justifyContent: 'center' },
  qtyText: { minWidth: 20, textAlign: 'center', fontWeight: '900' },
  cartInfo: { flex: 1, marginLeft: 12 },
  cartName: { textAlign: 'right', fontWeight: '900', fontSize: 16 },
  cartPrice: { textAlign: 'right', color: green, marginTop: 4, fontWeight: '800' },
  totalCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, flexDirection: 'row', justifyContent: 'space-between' },
  totalValue: { fontWeight: '900', fontSize: 24, color: green },
  totalLabel: { fontWeight: '900', fontSize: 18 },
  primaryButton: { backgroundColor: green, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 16 },
  primaryButtonText: { color: '#fff', textAlign: 'center', fontWeight: '900', fontSize: 16 },
  secondaryButton: { backgroundColor: '#fff', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: '#cfd9d3' },
  secondaryButtonText: { color: green, textAlign: 'center', fontWeight: '900' },
  textLink: { color: green, textAlign: 'center', fontWeight: '800', padding: 6 },
  blockedBox: { backgroundColor: '#fff3cd', borderRadius: 16, padding: 16 },
  blockedText: { color: '#7a5b00', textAlign: 'right', fontWeight: '800' },
  empty: { backgroundColor: '#fff', borderRadius: 18, padding: 24 },
  emptyTitle: { textAlign: 'center', fontWeight: '900' },
  orderSuccess: { backgroundColor: '#fff', borderRadius: 24, padding: 24, alignItems: 'center', gap: 6 },
  successMark: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#e7f5ed', color: green, textAlign: 'center', textAlignVertical: 'center', fontSize: 34, fontWeight: '900' },
  successTitle: { fontWeight: '900', fontSize: 20, marginTop: 8 },
  successOrder: { fontWeight: '900', fontSize: 28, color: green },
  successSub: { color: '#667085', textAlign: 'center' },
  orderCard: { backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 6 },
  orderStatus: { color: '#b7791f', backgroundColor: '#fff8e7', alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, fontWeight: '900' },
  orderNumber: { textAlign: 'right', fontSize: 22, fontWeight: '900' },
  orderMeta: { textAlign: 'right', color: '#667085' },
  orderOwner: { textAlign: 'right', color: green, fontWeight: '800' },
  managerActions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  smallAction: { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13 },
  smallActionText: { color: green, fontWeight: '900' },
  permissionHero: { backgroundColor: darkGreen, borderRadius: 22, padding: 20 },
  permissionHeroTitle: { color: '#fff', textAlign: 'right', fontSize: 23, fontWeight: '900' },
  permissionHeroText: { color: '#d8e7df', textAlign: 'right', lineHeight: 22, marginTop: 6 },
  permissionList: { gap: 9 },
  permissionRow: { backgroundColor: '#fff', borderRadius: 16, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  permissionText: { fontWeight: '800', textAlign: 'right' },
  permissionState: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, fontWeight: '900', fontSize: 12 },
  allowed: { backgroundColor: '#e8f7ef', color: '#137044' },
  denied: { backgroundColor: '#f2f4f7', color: '#98a2b3' },
});
