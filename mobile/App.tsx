import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Image, SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import {
  createTableOrder, getBranches, getBranchPosConfig, getCatalog, getDiningTables,
  getMyOrders, getOrderDetails, getProductModifiers, getSessionProfile, hasSession,
  sendToKitchen, signIn, signOut, updateTableOrder,
} from './src/gateway';
import { mobileConfigReady } from './src/supabase';
import type {
  BranchPosConfig, DiningTableSummary, MobileBranch, MobileSessionProfile, ModifierGroup,
  WaiterCartItemInput, WaiterCatalogProduct, WaiterOrderSummary,
} from './src/contracts';

type Screen = 'login' | 'branches' | 'tables' | 'menu' | 'cart' | 'orders' | 'permissions';
type ProductDraft = { product: WaiterCatalogProduct; quantity: number; notes: string; groups: ModifierGroup[]; selectedOptionIds: string[] };

const permissionLabels: Record<string, string> = {
  'pos.view': 'عرض نقطة البيع', 'pos.order.create': 'إنشاء طلب', 'pos.order.edit': 'تعديل الطلب',
  'pos.send_kitchen': 'إرسال الطلب للمطبخ', 'pos.payment.take': 'تحصيل / دفع',
  'pos.order.split': 'تقسيم الفاتورة', 'pos.order.transfer': 'نقل / دمج الطلب',
  'pos.void': 'إلغاء صنف', 'pos.discount': 'الخصومات', 'pos.change_price': 'تغيير السعر',
  'pos.hold': 'تعليق الطلب', 'pos.cancel_order': 'إلغاء الطلب', 'pos.refund': 'المرتجعات',
  'pos.kds_view': 'عرض المطبخ', 'pos.print_kitchen': 'طباعة المطبخ', 'pos.receipt.print': 'طباعة الإيصال',
  'pos.change_branch': 'تغيير الفرع', 'shifts.open': 'فتح شفت', 'shifts.close': 'إغلاق شفت',
  'settings.manage': 'إدارة الإعدادات', 'users.manage': 'إدارة المستخدمين', 'customers.manage': 'إدارة العملاء',
  'approvals.review': 'مراجعة الموافقات', 'approvals.override': 'تجاوز الموافقات', 'approvals.policy.manage': 'إدارة سياسة الموافقات',
};
const mobileActionPermissions = ['pos.view', 'pos.order.create', 'pos.order.edit', 'pos.send_kitchen', 'pos.payment.take', 'pos.order.split', 'pos.order.transfer'];
const money = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;
const errorMessage = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error || 'حدث خطأ');
  if (text.includes('Invalid login credentials')) return 'اسم المستخدم أو الرقم السري غير صحيح';
  if (text.includes('USERNAME_AND_PIN_REQUIRED')) return 'أدخل اسم المستخدم والرقم السري';
  if (text.includes('APPLICATION_PROFILE_REQUIRED')) return 'الحساب غير مرتبط بمستخدم نشط في النظام';
  if (text.includes('SESSION_REQUIRED')) return 'انتهت الجلسة، سجل الدخول مرة أخرى';
  if (text.toLowerCase().includes('permission')) return 'ليس لديك الصلاحية المطلوبة';
  if (text.includes('TABLE_BUSY')) return 'الطاولة مرتبطة بطلب مستخدم آخر';
  return text;
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [profile, setProfile] = useState<MobileSessionProfile | null>(null);
  const [branches, setBranches] = useState<MobileBranch[]>([]);
  const [branch, setBranch] = useState<MobileBranch | null>(null);
  const [config, setConfig] = useState<BranchPosConfig>({ taxEnabled: false, taxRate: 0, currency: 'EGP' });
  const [tables, setTables] = useState<DiningTableSummary[]>([]);
  const [area, setArea] = useState('الكل');
  const [selectedTable, setSelectedTable] = useState<DiningTableSummary | null>(null);
  const [guestCount, setGuestCount] = useState(2);
  const [catalog, setCatalog] = useState<WaiterCatalogProduct[]>([]);
  const [category, setCategory] = useState('الكل');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<WaiterCartItemInput[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeOrderNumber, setActiveOrderNumber] = useState<string | null>(null);
  const [orders, setOrders] = useState<WaiterOrderSummary[]>([]);
  const [draft, setDraft] = useState<ProductDraft | null>(null);

  const can = (permission: string) => Boolean(profile?.isSuperAdmin || profile?.permissions.includes(permission));
  const displayedPermissions = useMemo(() => {
    const values = new Set<string>([...mobileActionPermissions, ...(profile?.permissions || [])]);
    return [...values].sort();
  }, [profile?.permissions]);

  const chooseBranch = async (nextBranch: MobileBranch, effectiveProfile = profile) => {
    if (effectiveProfile && effectiveProfile.branchIds.length > 0 && !effectiveProfile.branchIds.includes(nextBranch.id) && !effectiveProfile.isSuperAdmin) throw new Error('ليس لديك وصول لهذا الفرع');
    setBusy(true); setErrorText('');
    try {
      const [nextConfig, nextTables, nextCatalog] = await Promise.all([
        getBranchPosConfig(nextBranch.id), getDiningTables(nextBranch.id), getCatalog(nextBranch.id),
      ]);
      setBranch(nextBranch); setConfig(nextConfig); setTables(nextTables); setCatalog(nextCatalog);
      setArea('الكل'); setCategory('الكل'); setCart([]); setSelectedTable(null);
      setActiveOrderId(null); setActiveOrderNumber(null); setScreen('tables');
    } finally { setBusy(false); }
  };

  const loadIdentity = async () => {
    const nextProfile = await getSessionProfile();
    const nextBranches = await getBranches();
    setProfile(nextProfile); setBranches(nextBranches);
    const preferred = nextBranches.find((item) => item.id === nextProfile.primaryBranchId) || nextBranches[0] || null;
    if (preferred) await chooseBranch(preferred, nextProfile); else setScreen('branches');
  };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try { if (mobileConfigReady && await hasSession()) await loadIdentity(); }
      catch { await signOut().catch(() => undefined); }
      finally { if (mounted) setBooting(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const areas = useMemo(() => ['الكل', ...new Set(tables.map((table) => table.areaName || 'بدون صالة'))], [tables]);
  const visibleTables = useMemo(() => tables.filter((table) => area === 'الكل' || (table.areaName || 'بدون صالة') === area), [tables, area]);
  const categories = useMemo(() => ['الكل', ...new Set(catalog.map((item) => item.categoryName || 'بدون تصنيف'))], [catalog]);
  const visibleCatalog = useMemo(() => catalog.filter((item) => {
    const q = search.trim().toLowerCase();
    return (category === 'الكل' || (item.categoryName || 'بدون تصنيف') === category) && (!q || item.name.toLowerCase().includes(q) || (item.nameEn || '').toLowerCase().includes(q));
  }), [catalog, category, search]);
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const taxAmount = config.taxEnabled ? subtotal * (config.taxRate / 100) : 0;
  const total = subtotal + taxAmount;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const login = async () => {
    setBusy(true); setErrorText('');
    try { await signIn(username, pin); await loadIdentity(); setPin(''); }
    catch (error) { setErrorText(errorMessage(error)); }
    finally { setBusy(false); setBooting(false); }
  };
  const logout = async () => {
    await signOut(); setProfile(null); setBranches([]); setBranch(null); setTables([]); setCatalog([]);
    setCart([]); setSelectedTable(null); setActiveOrderId(null); setActiveOrderNumber(null); setScreen('login');
  };
  const refreshTables = async () => { if (branch) setTables(await getDiningTables(branch.id)); };
  const refreshOrders = async () => { if (branch) setOrders(await getMyOrders(branch.id)); };
  const openOrders = async () => {
    setBusy(true); setErrorText('');
    try { await refreshOrders(); setScreen('orders'); }
    catch (error) { setErrorText(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const openTable = async (table: DiningTableSummary) => {
    setErrorText(''); setNotice('');
    if (!can('pos.view')) return setErrorText('لا تملك صلاحية عرض نقطة البيع');
    setBusy(true);
    try {
      setSelectedTable(table); setGuestCount(table.guestCount || table.capacity || 2);
      if (table.activeOrderId) {
        if (!can('pos.order.edit')) throw new Error('هذه الطاولة مشغولة ولا تملك صلاحية تعديل الطلب');
        const details = await getOrderDetails(table.activeOrderId);
        setCart(details.items); setGuestCount(details.guestCount || table.guestCount || 2);
        setActiveOrderId(details.orderId); setActiveOrderNumber(details.orderNumber);
      } else {
        if (!can('pos.order.create')) throw new Error('لا تملك صلاحية إنشاء طلب');
        setCart([]); setActiveOrderId(null); setActiveOrderNumber(null);
      }
      setScreen('menu');
    } catch (error) { setErrorText(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const openProduct = async (product: WaiterCatalogProduct) => {
    if (activeOrderId ? !can('pos.order.edit') : !can('pos.order.create')) return;
    setBusy(true); setErrorText('');
    try {
      const groups = await getProductModifiers(product.id);
      const selectedOptionIds = groups.flatMap((group) => group.options.filter((option) => option.isDefault).slice(0, group.maxSelections).map((option) => option.id));
      setDraft({ product, quantity: 1, notes: '', groups, selectedOptionIds });
    } catch (error) { setErrorText(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const toggleModifier = (group: ModifierGroup, optionId: string) => setDraft((current) => {
    if (!current) return current;
    const groupIds = new Set(group.options.map((option) => option.id));
    const selected = current.selectedOptionIds.filter((id) => groupIds.has(id));
    let next = current.selectedOptionIds;
    if (next.includes(optionId)) next = next.filter((id) => id !== optionId);
    else if (group.maxSelections === 1) next = [...next.filter((id) => !groupIds.has(id)), optionId];
    else if (selected.length < group.maxSelections) next = [...next, optionId];
    return { ...current, selectedOptionIds: next };
  });
  const addDraft = () => {
    if (!draft) return;
    for (const group of draft.groups) {
      const ids = new Set(group.options.map((option) => option.id));
      if (draft.selectedOptionIds.filter((id) => ids.has(id)).length < group.minSelections) return setErrorText(`اختر ${group.minSelections} على الأقل من ${group.name}`);
    }
    const delta = draft.groups.flatMap((group) => group.options).filter((option) => draft.selectedOptionIds.includes(option.id)).reduce((sum, option) => sum + option.priceDelta, 0);
    setCart((current) => [...current, { productId: draft.product.id, name: draft.product.name, unitPrice: Math.max(0, draft.product.salePrice + delta), quantity: draft.quantity, modifierOptionIds: draft.selectedOptionIds, notes: draft.notes.trim() || undefined }]);
    setDraft(null); setErrorText('');
  };
  const changeQty = (index: number, delta: number) => setCart((current) => current.map((item, i) => i === index ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter((item) => item.quantity > 0));

  const sendOrder = async () => {
    if (!branch || !selectedTable || cart.length === 0) return;
    if (!can('pos.send_kitchen')) return setErrorText('لا تملك صلاحية الإرسال للمطبخ');
    setBusy(true); setErrorText(''); setNotice('');
    try {
      let orderId = activeOrderId; let orderNumber = activeOrderNumber;
      if (orderId) await updateTableOrder(orderId, cart, config);
      else {
        const created = await createTableOrder({ branchId: branch.id, tableId: selectedTable.id, guestCount, items: cart, taxEnabled: config.taxEnabled, taxRate: config.taxRate });
        orderId = created.orderId; orderNumber = created.orderNumber; setActiveOrderId(orderId); setActiveOrderNumber(orderNumber);
      }
      const count = await sendToKitchen(orderId);
      setNotice(count > 0 ? `تم إرسال ${count} صنف/سطر للمطبخ بنجاح` : 'كل الأصناف الحالية مرسلة للمطبخ بالفعل');
      setActiveOrderNumber(orderNumber); await refreshTables(); await refreshOrders(); setScreen('orders');
    } catch (error) { setErrorText(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const Header = ({ title }: { title: string }) => <View style={s.header}>
    <View style={{ flex: 1, alignItems: 'flex-end' }}><Text style={s.title}>{title}</Text><Text style={s.sub}>{branch?.name || 'Johna S'} · {profile?.displayName || ''}</Text></View>
    <TouchableOpacity style={s.avatar} onPress={() => setScreen('permissions')}><Text style={s.avatarText}>{profile?.displayName?.charAt(0) || 'J'}</Text></TouchableOpacity>
  </View>;
  const Nav = () => <View style={s.nav}>
    <TouchableOpacity onPress={() => setScreen('tables')}><Text style={s.navText}>الطاولات</Text></TouchableOpacity>
    <TouchableOpacity onPress={openOrders}><Text style={s.navText}>طلباتي</Text></TouchableOpacity>
    <TouchableOpacity onPress={() => setScreen('permissions')}><Text style={s.navText}>صلاحياتي</Text></TouchableOpacity>
  </View>;
  const Error = () => errorText ? <View style={s.error}><Text style={s.errorText}>{errorText}</Text></View> : null;

  if (booting) return <SafeAreaView style={s.center}><ActivityIndicator size="large" /><Text>جاري تشغيل التطبيق...</Text></SafeAreaView>;
  if (screen === 'login') return <SafeAreaView style={s.login}><View style={s.loginWrap}>
    <Text style={s.logo}>Johna S</Text><Text style={s.loginTitle}>طلبات نادل الصالة</Text><Text style={s.loginHint}>نفس حساب وصلاحيات النظام الحالي</Text>
    {!mobileConfigReady && <View style={s.error}><Text style={s.errorText}>نسخة البناء لا تحتوي مفتاح الاتصال العام.</Text></View>}
    <View style={s.card}><Text style={s.label}>اسم المستخدم</Text><TextInput style={s.input} value={username} onChangeText={setUsername} autoCapitalize="none" textAlign="right" />
      <Text style={s.label}>الرقم السري / PIN</Text><TextInput style={s.input} value={pin} onChangeText={setPin} secureTextEntry textAlign="right" /><Error />
      <TouchableOpacity style={[s.primary, busy && s.disabled]} disabled={busy || !mobileConfigReady} onPress={login}>{busy ? <ActivityIndicator /> : <Text style={s.primaryText}>تسجيل الدخول</Text>}</TouchableOpacity>
    </View>
  </View></SafeAreaView>;

  if (screen === 'branches') return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}><Header title="اختيار الفرع" />
    {branches.map((item) => <TouchableOpacity key={item.id} style={s.list} onPress={() => void chooseBranch(item)}><Text style={s.listTitle}>{item.name}</Text><Text style={s.muted}>فتح الفرع</Text></TouchableOpacity>)}
    <TouchableOpacity style={s.secondary} onPress={logout}><Text style={s.secondaryText}>تسجيل الخروج</Text></TouchableOpacity></ScrollView></SafeAreaView>;

  if (screen === 'permissions') return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}><Header title="صلاحياتي" />
    <View style={s.hero}><Text style={s.heroTitle}>{profile?.displayName}</Text><Text style={s.heroText}>{profile?.isSuperAdmin ? 'Super Admin' : profile?.role || 'مستخدم'} · {profile?.permissions.length || 0} صلاحية مسجلة</Text></View>
    {displayedPermissions.map((permission) => <View key={permission} style={s.permission}><View style={{ flex: 1, alignItems: 'flex-end' }}><Text style={s.permissionName}>{permissionLabels[permission] || permission}</Text><Text style={s.code}>{permission}</Text></View><Text style={[s.state, can(permission) ? s.allowed : s.denied]}>{can(permission) ? 'مسموح' : 'غير مسموح'}</Text></View>)}
    {branches.length > 1 && <TouchableOpacity style={s.secondary} onPress={() => setScreen('branches')}><Text style={s.secondaryText}>تغيير الفرع</Text></TouchableOpacity>}
    <TouchableOpacity style={s.secondary} onPress={logout}><Text style={s.secondaryText}>تسجيل الخروج</Text></TouchableOpacity><Nav />
  </ScrollView></SafeAreaView>;

  if (screen === 'tables') return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}><Header title="اختيار الطاولة" /><Error />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{areas.map((item) => <TouchableOpacity key={item} style={[s.chip, area === item && s.chipOn]} onPress={() => setArea(item)}><Text style={[s.chipText, area === item && s.chipTextOn]}>{item}</Text></TouchableOpacity>)}</ScrollView>
    <View style={s.grid}>{visibleTables.map((table) => <TouchableOpacity key={table.id} style={[s.table, table.status === 'occupied' && s.occupied]} onPress={() => void openTable(table)}><Text style={s.tableName}>{table.name}</Text><Text style={s.gold}>{table.status === 'occupied' ? 'مشغولة' : 'متاحة'}</Text>{table.activeWaiterName && <Text style={s.muted}>النادل: {table.activeWaiterName}</Text>}{table.guestCount ? <Text style={s.muted}>{table.guestCount} ضيوف</Text> : null}</TouchableOpacity>)}</View>
    <TouchableOpacity style={s.secondary} onPress={() => void refreshTables()}><Text style={s.secondaryText}>تحديث الطاولات</Text></TouchableOpacity><Nav />
  </ScrollView></SafeAreaView>;

  if (screen === 'menu') return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}><Header title={selectedTable?.name || 'المنيو'} /><Error />
    <View style={s.context}><Text style={s.listTitle}>{activeOrderNumber ? `الطلب #${activeOrderNumber}` : 'طلب جديد'}</Text><View style={s.qtyRow}><TouchableOpacity style={s.qty} onPress={() => setGuestCount((v) => Math.max(1, v - 1))}><Text>−</Text></TouchableOpacity><Text style={s.bold}>{guestCount} ضيوف</Text><TouchableOpacity style={s.qty} onPress={() => setGuestCount((v) => v + 1)}><Text>+</Text></TouchableOpacity></View></View>
    <TextInput style={s.input} value={search} onChangeText={setSearch} textAlign="right" placeholder="ابحث عن صنف..." />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{categories.map((item) => <TouchableOpacity key={item} style={[s.chip, category === item && s.chipOn]} onPress={() => setCategory(item)}><Text style={[s.chipText, category === item && s.chipTextOn]}>{item}</Text></TouchableOpacity>)}</ScrollView>
    <View style={s.grid}>{visibleCatalog.map((product) => <TouchableOpacity key={product.id} style={s.product} onPress={() => void openProduct(product)}>{product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={s.image} /> : <View style={s.placeholder}><Text style={s.bold}>{product.categoryName || product.name}</Text></View>}<Text style={s.productName}>{product.name}</Text><Text style={s.gold}>{money(product.salePrice, config.currency)}</Text></TouchableOpacity>)}</View>
    <TouchableOpacity style={s.cartBar} onPress={() => setScreen('cart')}><Text style={s.goldLight}>{money(total, config.currency)}</Text><Text style={s.primaryText}>السلة · {itemCount}</Text></TouchableOpacity><Nav />
    {draft && <View style={s.backdrop}><View style={s.sheet}><ScrollView><Text style={s.title}>{draft.product.name}</Text><Text style={s.gold}>{money(draft.product.salePrice, config.currency)}</Text>
      <View style={s.qtyRow}><TouchableOpacity style={s.qty} onPress={() => setDraft((d) => d ? { ...d, quantity: Math.max(1, d.quantity - 1) } : d)}><Text>−</Text></TouchableOpacity><Text style={s.bold}>الكمية {draft.quantity}</Text><TouchableOpacity style={s.qty} onPress={() => setDraft((d) => d ? { ...d, quantity: d.quantity + 1 } : d)}><Text>+</Text></TouchableOpacity></View>
      {draft.groups.map((group) => <View key={group.id} style={s.mod}><Text style={s.bold}>{group.name} · {group.minSelections > 0 ? 'مطلوب' : 'اختياري'}</Text>{group.options.map((option) => { const on = draft.selectedOptionIds.includes(option.id); return <TouchableOpacity key={option.id} style={[s.modOption, on && s.modOn]} onPress={() => toggleModifier(group, option.id)}><Text style={s.right}>{on ? '✓ ' : ''}{option.name}{option.priceDelta ? ` (+${money(option.priceDelta, config.currency)})` : ''}</Text></TouchableOpacity>; })}</View>)}
      <TextInput style={[s.input, { minHeight: 80 }]} multiline value={draft.notes} onChangeText={(v) => setDraft((d) => d ? { ...d, notes: v } : d)} textAlign="right" placeholder="ملاحظات الصنف..." /><Error />
      <TouchableOpacity style={s.primary} onPress={addDraft}><Text style={s.primaryText}>إضافة إلى الطلب</Text></TouchableOpacity><TouchableOpacity style={s.secondary} onPress={() => { setDraft(null); setErrorText(''); }}><Text style={s.secondaryText}>إلغاء</Text></TouchableOpacity>
    </ScrollView></View></View>}
  </ScrollView></SafeAreaView>;

  if (screen === 'cart') return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}><Header title="مراجعة الطلب" /><Error />
    {cart.map((item, index) => <View key={`${item.productId}-${index}`} style={s.cartLine}><View style={s.qtyRow}><TouchableOpacity style={s.qty} onPress={() => changeQty(index, -1)}><Text>−</Text></TouchableOpacity><Text style={s.bold}>{item.quantity}</Text><TouchableOpacity style={s.qty} onPress={() => changeQty(index, 1)}><Text>+</Text></TouchableOpacity></View><View style={{ flex: 1, alignItems: 'flex-end' }}><Text style={s.listTitle}>{item.name}</Text>{item.notes && <Text style={s.muted}>{item.notes}</Text>}<Text style={s.gold}>{money(item.unitPrice * item.quantity, config.currency)}</Text></View></View>)}
    <View style={s.total}><Text style={s.right}>الإجمالي قبل الضريبة: {money(subtotal, config.currency)}</Text>{config.taxEnabled && <Text style={s.right}>الضريبة ({config.taxRate}%): {money(taxAmount, config.currency)}</Text>}<Text style={s.totalText}>الإجمالي: {money(total, config.currency)}</Text></View>
    <TouchableOpacity style={[s.primary, (!can('pos.send_kitchen') || busy || !cart.length) && s.disabled]} disabled={!can('pos.send_kitchen') || busy || !cart.length} onPress={sendOrder}>{busy ? <ActivityIndicator /> : <Text style={s.primaryText}>حفظ وإرسال للمطبخ</Text>}</TouchableOpacity>
    {!can('pos.send_kitchen') && <Text style={s.errorText}>لا تملك صلاحية الإرسال للمطبخ</Text>}<TouchableOpacity style={s.secondary} onPress={() => setScreen('menu')}><Text style={s.secondaryText}>إضافة أصناف أخرى</Text></TouchableOpacity><Nav />
  </ScrollView></SafeAreaView>;

  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}><Header title="طلباتي" />{notice ? <View style={s.success}><Text style={s.successText}>{notice}</Text></View> : null}<Error />
    {orders.map((order) => <TouchableOpacity key={order.orderId} style={s.order} onPress={async () => { setBusy(true); try { const d = await getOrderDetails(order.orderId); setSelectedTable(d.tableId ? tables.find((t) => t.id === d.tableId) || null : null); setCart(d.items); setGuestCount(d.guestCount || 2); setActiveOrderId(d.orderId); setActiveOrderNumber(d.orderNumber); if (d.status === 'open' || d.status === 'held') setScreen('menu'); } catch (error) { setErrorText(errorMessage(error)); } finally { setBusy(false); } }}><View><Text style={s.listTitle}>#{order.orderNumber}</Text><Text style={s.muted}>{order.tableName} · {order.waiterName}</Text></View><View><Text style={s.status}>{order.kitchenStatus || order.status}</Text><Text style={s.gold}>{money(order.total, config.currency)}</Text></View></TouchableOpacity>)}
    {!orders.length && <View style={s.card}><Text style={s.muted}>لا توجد طلبات لك في هذا الفرع</Text></View>}<TouchableOpacity style={s.secondary} onPress={openOrders}><Text style={s.secondaryText}>تحديث الطلبات</Text></TouchableOpacity><Nav />
  </ScrollView></SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F2E9' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#F6F2E9' },
  container: { padding: 16, paddingBottom: 100, gap: 12 }, login: { flex: 1, backgroundColor: '#123B2D' }, loginWrap: { flex: 1, justifyContent: 'center', padding: 22, gap: 10 },
  logo: { color: '#D9B45B', fontSize: 38, fontWeight: '900', textAlign: 'center' }, loginTitle: { color: '#FFF', fontSize: 24, fontWeight: '900', textAlign: 'center' }, loginHint: { color: '#D7E4DE', textAlign: 'center' },
  header: { flexDirection: 'row-reverse', gap: 10, alignItems: 'center' }, title: { color: '#173B2D', fontSize: 23, fontWeight: '900', textAlign: 'right' }, sub: { color: '#6D766F', fontSize: 11 }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#D9B45B', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#173B2D', fontSize: 18, fontWeight: '900' },
  card: { backgroundColor: '#FFF', borderRadius: 18, padding: 15, gap: 10 }, hero: { backgroundColor: '#173B2D', borderRadius: 18, padding: 16 }, heroTitle: { color: '#FFF', fontSize: 19, fontWeight: '900', textAlign: 'right' }, heroText: { color: '#D7E4DE', textAlign: 'right' },
  label: { color: '#173B2D', fontWeight: '900', textAlign: 'right' }, input: { minHeight: 48, borderWidth: 1, borderColor: '#DDD5C3', borderRadius: 14, backgroundColor: '#FFF', paddingHorizontal: 14, color: '#173B2D' },
  primary: { minHeight: 52, borderRadius: 15, backgroundColor: '#173B2D', alignItems: 'center', justifyContent: 'center', padding: 12 }, primaryText: { color: '#FFF', fontWeight: '900', fontSize: 15 }, secondary: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: '#B7AA8C', backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', padding: 10 }, secondaryText: { color: '#173B2D', fontWeight: '900' }, disabled: { opacity: 0.45 },
  error: { backgroundColor: '#FDECEC', borderRadius: 12, padding: 10 }, errorText: { color: '#9C2525', textAlign: 'right', fontWeight: '800' }, success: { backgroundColor: '#E8F5EE', borderRadius: 12, padding: 10 }, successText: { color: '#17643D', textAlign: 'right', fontWeight: '800' },
  list: { backgroundColor: '#FFF', minHeight: 66, borderRadius: 15, padding: 14, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }, listTitle: { color: '#173B2D', fontSize: 16, fontWeight: '900', textAlign: 'right' }, muted: { color: '#737B76', fontSize: 11, textAlign: 'right' }, bold: { color: '#173B2D', fontWeight: '900' }, right: { color: '#173B2D', textAlign: 'right' },
  permission: { backgroundColor: '#FFF', borderRadius: 14, padding: 12, flexDirection: 'row-reverse', gap: 10, alignItems: 'center' }, permissionName: { color: '#173B2D', fontWeight: '900', textAlign: 'right' }, code: { color: '#8B918D', fontSize: 10 }, state: { fontSize: 10, fontWeight: '900', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden' }, allowed: { color: '#17643D', backgroundColor: '#E8F5EE' }, denied: { color: '#9C2525', backgroundColor: '#FDECEC' },
  chips: { gap: 8 }, chip: { backgroundColor: '#ECE5D6', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 }, chipOn: { backgroundColor: '#173B2D' }, chipText: { color: '#173B2D', fontWeight: '800' }, chipTextOn: { color: '#FFF' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }, table: { width: '48%', minHeight: 120, backgroundColor: '#FFF', borderRadius: 17, padding: 13, alignItems: 'flex-end', justifyContent: 'center', borderWidth: 1, borderColor: '#E2DCCF' }, occupied: { backgroundColor: '#F8E9E4', borderColor: '#D79A87' }, tableName: { color: '#173B2D', fontSize: 19, fontWeight: '900' },
  product: { width: '48%', backgroundColor: '#FFF', borderRadius: 16, overflow: 'hidden', paddingBottom: 10 }, image: { width: '100%', height: 110 }, placeholder: { height: 110, backgroundColor: '#E9E3D5', alignItems: 'center', justifyContent: 'center', padding: 8 }, productName: { color: '#173B2D', fontWeight: '900', textAlign: 'right', paddingHorizontal: 9, marginTop: 7 }, gold: { color: '#9A762B', fontWeight: '900', textAlign: 'right', marginTop: 3 }, goldLight: { color: '#D9B45B', fontWeight: '900' },
  context: { backgroundColor: '#FFF', borderRadius: 15, padding: 12, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }, qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, qty: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#EFE8D9', alignItems: 'center', justifyContent: 'center' },
  cartBar: { minHeight: 54, borderRadius: 16, backgroundColor: '#173B2D', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 }, backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', zIndex: 50 }, sheet: { maxHeight: '88%', backgroundColor: '#F6F2E9', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 17 }, mod: { backgroundColor: '#FFF', borderRadius: 13, padding: 10, marginVertical: 6 }, modOption: { minHeight: 40, borderWidth: 1, borderColor: '#DDD5C3', borderRadius: 10, padding: 9, marginTop: 6 }, modOn: { backgroundColor: '#E8F0EC', borderColor: '#173B2D' },
  cartLine: { backgroundColor: '#FFF', borderRadius: 14, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' }, total: { backgroundColor: '#FFF', borderRadius: 15, padding: 13, gap: 5 }, totalText: { color: '#173B2D', fontSize: 18, fontWeight: '900', textAlign: 'right' }, order: { backgroundColor: '#FFF', minHeight: 74, borderRadius: 15, padding: 12, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }, status: { color: '#17643D', backgroundColor: '#E8F5EE', borderRadius: 9, padding: 5, fontWeight: '900', overflow: 'hidden' },
  nav: { minHeight: 56, backgroundColor: '#FFF', borderRadius: 16, flexDirection: 'row-reverse', justifyContent: 'space-around', alignItems: 'center', borderWidth: 1, borderColor: '#E2DCCF', marginTop: 8 }, navText: { color: '#173B2D', fontWeight: '900' },
});
