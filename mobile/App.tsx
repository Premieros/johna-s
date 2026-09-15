import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  createTableOrder,
  getBranches,
  getBranchPosConfig,
  getCatalog,
  getDiningTables,
  getMyOrders,
  getOrderDetails,
  getProductModifiers,
  getSessionProfile,
  hasSession,
  sendToKitchen,
  signIn,
  signOut,
  updateTableOrder,
} from './src/gateway';
import { mobileConfigReady } from './src/supabase';
import type {
  BranchPosConfig,
  DiningTableSummary,
  MobileBranch,
  MobilePermission,
  MobileSessionProfile,
  ModifierGroup,
  WaiterCartItemInput,
  WaiterCatalogProduct,
  WaiterOrderSummary,
} from './src/contracts';

type Screen = 'login' | 'branches' | 'tables' | 'menu' | 'cart' | 'orders' | 'permissions';

type ProductDraft = {
  product: WaiterCatalogProduct;
  quantity: number;
  notes: string;
  groups: ModifierGroup[];
  selectedOptionIds: string[];
};

const permissionLabels: Record<MobilePermission, string> = {
  'pos.view': 'عرض نقطة البيع',
  'pos.order.create': 'إنشاء طلب',
  'pos.order.edit': 'تعديل الطلب',
  'pos.send_kitchen': 'إرسال الطلب للمطبخ',
  'pos.payment.take': 'تحصيل / دفع',
  'pos.order.split': 'تقسيم الفاتورة',
  'pos.order.transfer': 'نقل / دمج الطلب',
  'approvals.review': 'مراجعة الموافقات',
  'approvals.override': 'تجاوز الموافقات المسموح بها',
};

const money = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;

const messageForError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error || 'حدث خطأ');
  if (text.includes('Invalid login credentials')) return 'اسم المستخدم أو الرقم السري غير صحيح';
  if (text.includes('USERNAME_AND_PIN_REQUIRED')) return 'أدخل اسم المستخدم والرقم السري';
  if (text.includes('APPLICATION_PROFILE_REQUIRED')) return 'الحساب غير مرتبط بمستخدم نشط في النظام';
  if (text.includes('SESSION_REQUIRED')) return 'انتهت الجلسة، سجل الدخول مرة أخرى';
  if (text.includes('permission') || text.includes('PERMISSION')) return 'ليس لديك الصلاحية المطلوبة';
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

  const can = (permission: MobilePermission) => profile?.isSuperAdmin || profile?.permissions.includes(permission) || false;

  const loadIdentity = async () => {
    const nextProfile = await getSessionProfile();
    const nextBranches = await getBranches();
    setProfile(nextProfile);
    setBranches(nextBranches);
    const preferred = nextBranches.find((item) => item.id === nextProfile.primaryBranchId) || nextBranches[0] || null;
    if (preferred) {
      await selectBranch(preferred, nextProfile);
    } else {
      setBranch(null);
      setScreen('branches');
    }
  };

  const selectBranch = async (nextBranch: MobileBranch, effectiveProfile = profile) => {
    if (effectiveProfile && effectiveProfile.branchIds.length > 0 && !effectiveProfile.branchIds.includes(nextBranch.id) && !effectiveProfile.isSuperAdmin) {
      throw new Error('ليس لديك وصول لهذا الفرع');
    }
    setBusy(true);
    setErrorText('');
    try {
      const [nextConfig, nextTables, nextCatalog] = await Promise.all([
        getBranchPosConfig(nextBranch.id),
        getDiningTables(nextBranch.id),
        getCatalog(nextBranch.id),
      ]);
      setBranch(nextBranch);
      setConfig(nextConfig);
      setTables(nextTables);
      setCatalog(nextCatalog);
      setArea('الكل');
      setCategory('الكل');
      setCart([]);
      setSelectedTable(null);
      setActiveOrderId(null);
      setActiveOrderNumber(null);
      setScreen('tables');
    } finally {
      setBusy(false);
    }
  };

  const refreshTables = async () => {
    if (!branch) return;
    const next = await getDiningTables(branch.id);
    setTables(next);
  };

  const refreshOrders = async () => {
    if (!branch) return;
    setOrders(await getMyOrders(branch.id));
  };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        if (mobileConfigReady && await hasSession()) {
          await loadIdentity();
        }
      } catch {
        await signOut().catch(() => undefined);
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const areas = useMemo(() => ['الكل', ...Array.from(new Set(tables.map((table) => table.areaName || 'بدون صالة')))], [tables]);
  const visibleTables = useMemo(() => tables.filter((table) => area === 'الكل' || (table.areaName || 'بدون صالة') === area), [tables, area]);
  const categories = useMemo(() => ['الكل', ...Array.from(new Set(catalog.map((item) => item.categoryName || 'بدون تصنيف')))], [catalog]);
  const visibleCatalog = useMemo(() => catalog.filter((item) => {
    const matchesCategory = category === 'الكل' || (item.categoryName || 'بدون تصنيف') === category;
    const q = search.trim();
    const matchesSearch = !q || item.name.includes(q) || (item.nameEn || '').toLowerCase().includes(q.toLowerCase());
    return matchesCategory && matchesSearch;
  }), [catalog, category, search]);
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const taxAmount = config.taxEnabled ? subtotal * (config.taxRate / 100) : 0;
  const total = subtotal + taxAmount;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleLogin = async () => {
    setBusy(true);
    setErrorText('');
    try {
      await signIn(username, pin);
      await loadIdentity();
      setPin('');
    } catch (error) {
      setErrorText(messageForError(error));
    } finally {
      setBusy(false);
      setBooting(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    setProfile(null);
    setBranches([]);
    setBranch(null);
    setTables([]);
    setCatalog([]);
    setCart([]);
    setSelectedTable(null);
    setActiveOrderId(null);
    setActiveOrderNumber(null);
    setScreen('login');
  };

  const openTable = async (table: DiningTableSummary) => {
    setErrorText('');
    setNotice('');
    if (!can('pos.view')) {
      setErrorText('لا تملك صلاحية عرض نقطة البيع');
      return;
    }
    setBusy(true);
    try {
      setSelectedTable(table);
      setGuestCount(table.guestCount || table.capacity || 2);
      if (table.activeOrderId) {
        if (!can('pos.order.edit')) throw new Error('هذه الطاولة مشغولة ولا تملك صلاحية تعديل الطلب');
        const details = await getOrderDetails(table.activeOrderId);
        setCart(details.items);
        setGuestCount(details.guestCount || table.guestCount || 2);
        setActiveOrderId(details.orderId);
        setActiveOrderNumber(details.orderNumber);
      } else {
        if (!can('pos.order.create')) throw new Error('لا تملك صلاحية إنشاء طلب');
        setCart([]);
        setActiveOrderId(null);
        setActiveOrderNumber(null);
      }
      setScreen('menu');
    } catch (error) {
      setErrorText(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const openProduct = async (product: WaiterCatalogProduct) => {
    if (activeOrderId ? !can('pos.order.edit') : !can('pos.order.create')) return;
    setBusy(true);
    setErrorText('');
    try {
      const groups = await getProductModifiers(product.id);
      const defaults = groups.flatMap((group) => group.options.filter((option) => option.isDefault).slice(0, group.maxSelections).map((option) => option.id));
      setDraft({ product, quantity: 1, notes: '', groups, selectedOptionIds: defaults });
    } catch (error) {
      setErrorText(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleModifier = (group: ModifierGroup, optionId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const groupIds = new Set(group.options.map((option) => option.id));
      const selectedInGroup = current.selectedOptionIds.filter((id) => groupIds.has(id));
      let next = current.selectedOptionIds;
      if (next.includes(optionId)) next = next.filter((id) => id !== optionId);
      else if (group.maxSelections === 1) next = [...next.filter((id) => !groupIds.has(id)), optionId];
      else if (selectedInGroup.length < group.maxSelections) next = [...next, optionId];
      return { ...current, selectedOptionIds: next };
    });
  };

  const addDraft = () => {
    if (!draft) return;
    for (const group of draft.groups) {
      const groupIds = new Set(group.options.map((option) => option.id));
      const count = draft.selectedOptionIds.filter((id) => groupIds.has(id)).length;
      if (count < group.minSelections) {
        setErrorText(`اختر ${group.minSelections} على الأقل من ${group.name}`);
        return;
      }
    }
    const priceDelta = draft.groups.flatMap((group) => group.options)
      .filter((option) => draft.selectedOptionIds.includes(option.id))
      .reduce((sum, option) => sum + option.priceDelta, 0);
    setCart((current) => [...current, {
      productId: draft.product.id,
      name: draft.product.name,
      unitPrice: Math.max(0, draft.product.salePrice + priceDelta),
      quantity: draft.quantity,
      modifierOptionIds: draft.selectedOptionIds,
      notes: draft.notes.trim() || undefined,
    }]);
    setDraft(null);
    setErrorText('');
  };

  const changeCartQty = (index: number, delta: number) => {
    if (!can('pos.order.edit') && activeOrderId) return;
    setCart((current) => current
      .map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item)
      .filter((item) => item.quantity > 0));
  };

  const handleSend = async () => {
    if (!branch || !selectedTable || cart.length === 0) return;
    if (!can('pos.send_kitchen')) {
      setErrorText('لا تملك صلاحية الإرسال للمطبخ');
      return;
    }
    setBusy(true);
    setErrorText('');
    setNotice('');
    try {
      let orderId = activeOrderId;
      let orderNumber = activeOrderNumber;
      if (orderId) {
        await updateTableOrder(orderId, cart, config);
      } else {
        const created = await createTableOrder({
          branchId: branch.id,
          tableId: selectedTable.id,
          guestCount,
          items: cart,
          taxEnabled: config.taxEnabled,
          taxRate: config.taxRate,
        });
        orderId = created.orderId;
        orderNumber = created.orderNumber;
        setActiveOrderId(created.orderId);
        setActiveOrderNumber(created.orderNumber);
      }
      const sentCount = await sendToKitchen(orderId);
      setNotice(sentCount > 0 ? `تم إرسال ${sentCount} صنف/سطر للمطبخ بنجاح` : 'كل الأصناف الحالية مرسلة للمطبخ بالفعل');
      setActiveOrderNumber(orderNumber);
      await refreshTables();
      await refreshOrders();
      setScreen('orders');
    } catch (error) {
      setErrorText(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const openOrders = async () => {
    setBusy(true);
    setErrorText('');
    try {
      await refreshOrders();
      setScreen('orders');
    } catch (error) {
      setErrorText(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const Header = ({ title }: { title: string }) => (
    <View style={styles.header}>
      <View style={styles.headerTitleWrap}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerSub}>{branch?.name || 'Johna S'} · {profile?.displayName || ''}</Text>
      </View>
      <TouchableOpacity style={styles.avatar} onPress={() => setScreen('permissions')}>
        <Text style={styles.avatarText}>{profile?.displayName?.charAt(0) || 'J'}</Text>
      </TouchableOpacity>
    </View>
  );

  const BottomNav = () => (
    <View style={styles.bottomNav}>
      <TouchableOpacity onPress={() => setScreen('tables')}><Text style={styles.navText}>الطاولات</Text></TouchableOpacity>
      <TouchableOpacity onPress={openOrders}><Text style={styles.navText}>طلباتي</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => setScreen('permissions')}><Text style={styles.navText}>صلاحياتي</Text></TouchableOpacity>
    </View>
  );

  if (booting) {
    return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /><Text style={styles.loadingText}>جاري تشغيل التطبيق...</Text></SafeAreaView>;
  }

  if (screen === 'login') {
    return (
      <SafeAreaView style={styles.loginSafe}>
        <View style={styles.loginWrap}>
          <Text style={styles.logo}>Johna S</Text>
          <Text style={styles.loginTitle}>طلبات نادل الصالة</Text>
          <Text style={styles.loginHint}>نفس حساب وصلاحيات النظام الحالي</Text>
          {!mobileConfigReady && <View style={styles.errorBox}><Text style={styles.errorText}>نسخة البناء لا تحتوي مفتاح الاتصال العام. أعد بناء APK من GitHub Actions بعد ضبط VITE_SUPABASE_ANON_KEY.</Text></View>}
          <View style={styles.card}>
            <Text style={styles.label}>اسم المستخدم</Text>
            <TextInput value={username} onChangeText={setUsername} autoCapitalize="none" textAlign="right" style={styles.input} placeholder="username" />
            <Text style={styles.label}>الرقم السري / PIN</Text>
            <TextInput value={pin} onChangeText={setPin} secureTextEntry textAlign="right" style={styles.input} placeholder="••••••" />
            {!!errorText && <View style={styles.errorBox}><Text style={styles.errorText}>{errorText}</Text></View>}
            <TouchableOpacity style={[styles.primaryButton, busy && styles.disabled]} onPress={handleLogin} disabled={busy || !mobileConfigReady}>
              {busy ? <ActivityIndicator /> : <Text style={styles.primaryButtonText}>تسجيل الدخول</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'branches') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title="اختيار الفرع" />
          {branches.map((item) => (
            <TouchableOpacity key={item.id} style={styles.listCard} onPress={() => void selectBranch(item)}>
              <Text style={styles.listTitle}>{item.name}</Text>
              <Text style={styles.muted}>فتح فرع</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout}><Text style={styles.secondaryButtonText}>تسجيل الخروج</Text></TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'permissions') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title="صلاحياتي" />
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{profile?.displayName}</Text>
            <Text style={styles.heroText}>{profile?.isSuperAdmin ? 'Super Admin' : profile?.role || 'مستخدم'} · الصلاحيات مأخوذة من النظام الحالي</Text>
          </View>
          {(Object.keys(permissionLabels) as MobilePermission[]).map((permission) => (
            <View key={permission} style={styles.permissionRow}>
              <Text style={[styles.permissionState, can(permission) ? styles.allowed : styles.denied]}>{can(permission) ? 'مسموح' : 'غير مسموح'}</Text>
              <View style={styles.permissionCopy}><Text style={styles.permissionName}>{permissionLabels[permission]}</Text><Text style={styles.permissionCode}>{permission}</Text></View>
            </View>
          ))}
          {branches.length > 1 && <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('branches')}><Text style={styles.secondaryButtonText}>تغيير الفرع</Text></TouchableOpacity>}
          <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout}><Text style={styles.secondaryButtonText}>تسجيل الخروج</Text></TouchableOpacity>
          <BottomNav />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'tables') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title="اختيار الطاولة" />
          {!!errorText && <View style={styles.errorBox}><Text style={styles.errorText}>{errorText}</Text></View>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {areas.map((item) => <TouchableOpacity key={item} style={[styles.chip, area === item && styles.chipActive]} onPress={() => setArea(item)}><Text style={[styles.chipText, area === item && styles.chipTextActive]}>{item}</Text></TouchableOpacity>)}
          </ScrollView>
          <View style={styles.tableGrid}>
            {visibleTables.map((table) => (
              <TouchableOpacity key={table.id} style={[styles.tableCard, table.status === 'occupied' && styles.tableOccupied]} onPress={() => void openTable(table)}>
                <Text style={styles.tableName}>{table.name}</Text>
                <Text style={styles.tableStatus}>{table.status === 'occupied' ? 'مشغولة' : 'متاحة'}</Text>
                {table.activeWaiterName && <Text style={styles.waiterName}>النادل: {table.activeWaiterName}</Text>}
                {table.guestCount ? <Text style={styles.muted}>{table.guestCount} ضيوف</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
          {visibleTables.length === 0 && <View style={styles.empty}><Text style={styles.emptyTitle}>لا توجد طاولات في هذا الاختيار</Text></View>}
          <TouchableOpacity style={styles.refreshButton} onPress={() => void refreshTables()}><Text style={styles.secondaryButtonText}>تحديث الطاولات</Text></TouchableOpacity>
          <BottomNav />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'menu') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title={selectedTable?.name || 'المنيو'} />
          <View style={styles.orderContext}>
            <Text style={styles.orderContextTitle}>{activeOrderNumber ? `الطلب #${activeOrderNumber}` : 'طلب جديد'}</Text>
            <View style={styles.guestRow}>
              <TouchableOpacity style={styles.qtyButton} onPress={() => setGuestCount((value) => Math.max(1, value - 1))}><Text style={styles.qtyButtonText}>−</Text></TouchableOpacity>
              <Text style={styles.guestCount}>{guestCount} ضيوف</Text>
              <TouchableOpacity style={styles.qtyButton} onPress={() => setGuestCount((value) => value + 1)}><Text style={styles.qtyButtonText}>+</Text></TouchableOpacity>
            </View>
          </View>
          {!!errorText && <View style={styles.errorBox}><Text style={styles.errorText}>{errorText}</Text></View>}
          <TextInput style={styles.input} value={search} onChangeText={setSearch} textAlign="right" placeholder="ابحث عن صنف..." />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {categories.map((item) => <TouchableOpacity key={item} style={[styles.chip, category === item && styles.chipActive]} onPress={() => setCategory(item)}><Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text></TouchableOpacity>)}
          </ScrollView>
          <View style={styles.productGrid}>
            {visibleCatalog.map((product) => (
              <TouchableOpacity key={product.id} style={styles.productCard} onPress={() => void openProduct(product)}>
                {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.productImage} /> : <View style={styles.productPlaceholder}><Text style={styles.productPlaceholderText}>{product.categoryName || product.name}</Text></View>}
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productPrice}>{money(product.salePrice, config.currency)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.cartBar} onPress={() => setScreen('cart')}>
            <Text style={styles.cartBarValue}>{money(total, config.currency)}</Text>
            <Text style={styles.cartBarText}>السلة · {itemCount}</Text>
          </TouchableOpacity>
          <BottomNav />
        </ScrollView>
        {draft && (
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <ScrollView>
                <Text style={styles.modalTitle}>{draft.product.name}</Text>
                <Text style={styles.productPrice}>{money(draft.product.salePrice, config.currency)}</Text>
                <View style={styles.guestRow}>
                  <TouchableOpacity style={styles.qtyButton} onPress={() => setDraft((current) => current ? { ...current, quantity: Math.max(1, current.quantity - 1) } : current)}><Text style={styles.qtyButtonText}>−</Text></TouchableOpacity>
                  <Text style={styles.guestCount}>الكمية {draft.quantity}</Text>
                  <TouchableOpacity style={styles.qtyButton} onPress={() => setDraft((current) => current ? { ...current, quantity: current.quantity + 1 } : current)}><Text style={styles.qtyButtonText}>+</Text></TouchableOpacity>
                </View>
                {draft.groups.map((group) => (
                  <View key={group.id} style={styles.modGroup}>
                    <Text style={styles.modTitle}>{group.name} · {group.minSelections > 0 ? 'مطلوب' : 'اختياري'}</Text>
                    {group.options.map((option) => {
                      const active = draft.selectedOptionIds.includes(option.id);
                      return <TouchableOpacity key={option.id} style={[styles.modOption, active && styles.modOptionActive]} onPress={() => toggleModifier(group, option.id)}><Text style={styles.modOptionText}>{active ? '✓ ' : ''}{option.name} {option.priceDelta ? `(+${money(option.priceDelta, config.currency)})` : ''}</Text></TouchableOpacity>;
                    })}
                  </View>
                ))}
                <TextInput style={[styles.input, styles.notesInput]} value={draft.notes} onChangeText={(value) => setDraft((current) => current ? { ...current, notes: value } : current)} multiline textAlign="right" placeholder="ملاحظات الصنف..." />
                {!!errorText && <View style={styles.errorBox}><Text style={styles.errorText}>{errorText}</Text></View>}
                <TouchableOpacity style={styles.primaryButton} onPress={addDraft}><Text style={styles.primaryButtonText}>إضافة إلى الطلب</Text></TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => { setDraft(null); setErrorText(''); }}><Text style={styles.secondaryButtonText}>إلغاء</Text></TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        )}
      </SafeAreaView>
    );
  }

  if (screen === 'cart') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Header title="مراجعة الطلب" />
          {!!errorText && <View style={styles.errorBox}><Text style={styles.errorText}>{errorText}</Text></View>}
          {cart.map((item, index) => (
            <View key={`${item.productId}-${index}`} style={styles.cartLine}>
              <View style={styles.qtyControls}>
                <TouchableOpacity style={styles.qtyButton} onPress={() => changeCartQty(index, -1)}><Text style={styles.qtyButtonText}>−</Text></TouchableOpacity>
                <Text style={styles.qtyText}>{item.quantity}</Text>
                <TouchableOpacity style={styles.qtyButton} onPress={() => changeCartQty(index, 1)}><Text style={styles.qtyButtonText}>+</Text></TouchableOpacity>
              </View>
              <View style={styles.cartCopy}>
                <Text style={styles.cartName}>{item.name}</Text>
                {!!item.notes && <Text style={styles.muted}>{item.notes}</Text>}
                <Text style={styles.productPrice}>{money(item.unitPrice * item.quantity, config.currency)}</Text>
              </View>
            </View>
          ))}
          {cart.length === 0 && <View style={styles.empty}><Text style={styles.emptyTitle}>السلة فارغة</Text></View>}
          <View style={styles.totalCard}>
            <Text style={styles.totalRow}>الإجمالي قبل الضريبة: {money(subtotal, config.currency)}</Text>
            {config.taxEnabled && <Text style={styles.totalRow}>الضريبة ({config.taxRate}%): {money(taxAmount, config.currency)}</Text>}
            <Text style={styles.totalMain}>الإجمالي: {money(total, config.currency)}</Text>
          </View>
          <TouchableOpacity style={[styles.primaryButton, (busy || cart.length === 0 || !can('pos.send_kitchen')) && styles.disabled]} disabled={busy || cart.length === 0 || !can('pos.send_kitchen')} onPress={handleSend}>
            {busy ? <ActivityIndicator /> : <Text style={styles.primaryButtonText}>حفظ وإرسال للمطبخ</Text>}
          </TouchableOpacity>
          {!can('pos.send_kitchen') && <Text style={styles.deniedHint}>لا تملك صلاحية الإرسال للمطبخ</Text>}
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('menu')}><Text style={styles.secondaryButtonText}>إضافة أصناف أخرى</Text></TouchableOpacity>
          <BottomNav />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Header title="طلباتي" />
        {!!notice && <View style={styles.successBox}><Text style={styles.successText}>{notice}</Text></View>}
        {!!errorText && <View style={styles.errorBox}><Text style={styles.errorText}>{errorText}</Text></View>}
        {orders.map((order) => (
          <TouchableOpacity key={order.orderId} style={styles.orderCard} onPress={async () => {
            setBusy(true);
            try {
              const details = await getOrderDetails(order.orderId);
              if (details.tableId) {
                const table = tables.find((item) => item.id === details.tableId) || null;
                setSelectedTable(table);
              }
              setCart(details.items);
              setGuestCount(details.guestCount || 2);
              setActiveOrderId(details.orderId);
              setActiveOrderNumber(details.orderNumber);
              if (details.status === 'open' || details.status === 'held') setScreen('menu');
            } catch (error) {
              setErrorText(messageForError(error));
            } finally {
              setBusy(false);
            }
          }}>
            <View>
              <Text style={styles.orderNumber}>#{order.orderNumber}</Text>
              <Text style={styles.muted}>{order.tableName} · {order.waiterName}</Text>
            </View>
            <View style={styles.orderStatusWrap}>
              <Text style={styles.orderStatus}>{order.kitchenStatus || order.status}</Text>
              <Text style={styles.productPrice}>{money(order.total, config.currency)}</Text>
            </View>
          </TouchableOpacity>
        ))}
        {orders.length === 0 && <View style={styles.empty}><Text style={styles.emptyTitle}>لا توجد طلبات لك في هذا الفرع</Text></View>}
        <TouchableOpacity style={styles.refreshButton} onPress={openOrders}><Text style={styles.secondaryButtonText}>تحديث الطلبات</Text></TouchableOpacity>
        <BottomNav />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F2E9' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#F6F2E9' },
  loadingText: { color: '#173B2D', fontWeight: '800' },
  container: { padding: 16, paddingBottom: 110, gap: 12 },
  loginSafe: { flex: 1, backgroundColor: '#123B2D' },
  loginWrap: { flex: 1, justifyContent: 'center', padding: 22, gap: 10 },
  logo: { color: '#D9B45B', fontSize: 38, fontWeight: '900', textAlign: 'center' },
  loginTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  loginHint: { color: '#D7E4DE', textAlign: 'center', marginBottom: 12 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, gap: 10 },
  label: { color: '#173B2D', fontWeight: '900', textAlign: 'right' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#DDD5C3', borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, color: '#173B2D' },
  notesInput: { minHeight: 82, textAlignVertical: 'top', paddingTop: 12 },
  primaryButton: { minHeight: 52, borderRadius: 15, backgroundColor: '#173B2D', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  secondaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#B7AA8C', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  secondaryButtonText: { color: '#173B2D', fontWeight: '900' },
  refreshButton: { minHeight: 44, borderRadius: 12, backgroundColor: '#EFE8D9', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  errorBox: { backgroundColor: '#FDECEC', borderRadius: 12, padding: 11, borderWidth: 1, borderColor: '#F0BABA' },
  errorText: { color: '#9C2525', textAlign: 'right', fontWeight: '700' },
  successBox: { backgroundColor: '#E8F5EE', borderRadius: 12, padding: 11, borderWidth: 1, borderColor: '#A9D8BD' },
  successText: { color: '#17643D', textAlign: 'right', fontWeight: '800' },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  headerTitleWrap: { alignItems: 'flex-end', flex: 1 },
  headerTitle: { color: '#173B2D', fontSize: 24, fontWeight: '900' },
  headerSub: { color: '#6D766F', fontSize: 12, marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#D9B45B', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#173B2D', fontWeight: '900', fontSize: 18 },
  hero: { backgroundColor: '#173B2D', borderRadius: 18, padding: 16 },
  heroTitle: { color: '#FFFFFF', textAlign: 'right', fontSize: 19, fontWeight: '900' },
  heroText: { color: '#D7E4DE', textAlign: 'right', marginTop: 4 },
  listCard: { minHeight: 68, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  listTitle: { color: '#173B2D', fontSize: 17, fontWeight: '900' },
  muted: { color: '#737B76', fontSize: 12 },
  permissionRow: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  permissionCopy: { alignItems: 'flex-end', flex: 1 },
  permissionName: { color: '#173B2D', fontWeight: '900', textAlign: 'right' },
  permissionCode: { color: '#8B918D', fontSize: 10, marginTop: 2 },
  permissionState: { fontSize: 11, fontWeight: '900', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, overflow: 'hidden' },
  allowed: { color: '#17643D', backgroundColor: '#E8F5EE' },
  denied: { color: '#9C2525', backgroundColor: '#FDECEC' },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#ECE5D6' },
  chipActive: { backgroundColor: '#173B2D' },
  chipText: { color: '#173B2D', fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF' },
  tableGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  tableCard: { width: '48%', minHeight: 128, borderRadius: 18, backgroundColor: '#FFFFFF', padding: 14, justifyContent: 'center', alignItems: 'flex-end', borderWidth: 1, borderColor: '#E2DCCF' },
  tableOccupied: { backgroundColor: '#F8E9E4', borderColor: '#D79A87' },
  tableName: { color: '#173B2D', fontSize: 19, fontWeight: '900' },
  tableStatus: { color: '#8B6B2B', fontWeight: '900', marginTop: 6 },
  waiterName: { color: '#5A625E', fontSize: 11, marginTop: 5, textAlign: 'right' },
  empty: { minHeight: 100, borderRadius: 16, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', padding: 18 },
  emptyTitle: { color: '#737B76', fontWeight: '800' },
  orderContext: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 13, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  orderContextTitle: { color: '#173B2D', fontWeight: '900' },
  guestRow: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  qtyButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#EFE8D9', justifyContent: 'center', alignItems: 'center' },
  qtyButtonText: { color: '#173B2D', fontSize: 20, fontWeight: '900' },
  guestCount: { color: '#173B2D', fontWeight: '900', minWidth: 68, textAlign: 'center' },
  productGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  productCard: { width: '48%', borderRadius: 16, backgroundColor: '#FFFFFF', overflow: 'hidden', paddingBottom: 11 },
  productImage: { width: '100%', height: 115, backgroundColor: '#E9E3D5' },
  productPlaceholder: { height: 115, backgroundColor: '#E9E3D5', alignItems: 'center', justifyContent: 'center', padding: 10 },
  productPlaceholderText: { color: '#7A6E54', fontWeight: '900', textAlign: 'center' },
  productName: { color: '#173B2D', fontWeight: '900', fontSize: 15, textAlign: 'right', paddingHorizontal: 10, marginTop: 8 },
  productPrice: { color: '#9A762B', fontWeight: '900', textAlign: 'right', paddingHorizontal: 10, marginTop: 3 },
  cartBar: { minHeight: 56, borderRadius: 17, backgroundColor: '#173B2D', paddingHorizontal: 17, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cartBarValue: { color: '#D9B45B', fontWeight: '900' },
  cartBarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', zIndex: 50 },
  modalCard: { maxHeight: '88%', backgroundColor: '#F6F2E9', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  modalTitle: { color: '#173B2D', textAlign: 'right', fontSize: 23, fontWeight: '900' },
  modGroup: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 11, marginVertical: 6 },
  modTitle: { color: '#173B2D', textAlign: 'right', fontWeight: '900', marginBottom: 8 },
  modOption: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#DDD5C3', marginTop: 6, paddingHorizontal: 10, justifyContent: 'center' },
  modOptionActive: { borderColor: '#173B2D', backgroundColor: '#E8F0EC' },
  modOptionText: { textAlign: 'right', color: '#173B2D', fontWeight: '700' },
  cartLine: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  qtyText: { color: '#173B2D', fontWeight: '900', minWidth: 20, textAlign: 'center' },
  cartCopy: { flex: 1, alignItems: 'flex-end' },
  cartName: { color: '#173B2D', fontWeight: '900', fontSize: 16 },
  totalCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, gap: 5 },
  totalRow: { color: '#6D766F', textAlign: 'right', fontWeight: '700' },
  totalMain: { color: '#173B2D', textAlign: 'right', fontSize: 19, fontWeight: '900', marginTop: 5 },
  deniedHint: { color: '#9C2525', fontWeight: '800', textAlign: 'center' },
  orderCard: { minHeight: 78, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 13, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  orderNumber: { color: '#173B2D', fontSize: 18, fontWeight: '900', textAlign: 'right' },
  orderStatusWrap: { alignItems: 'flex-start' },
  orderStatus: { color: '#17643D', backgroundColor: '#E8F5EE', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, overflow: 'hidden', fontWeight: '900', fontSize: 11 },
  bottomNav: { marginTop: 10, minHeight: 58, borderRadius: 17, backgroundColor: '#FFFFFF', flexDirection: 'row-reverse', justifyContent: 'space-around', alignItems: 'center', borderWidth: 1, borderColor: '#E2DCCF' },
  navText: { color: '#173B2D', fontWeight: '900' },
});
