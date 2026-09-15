import { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Mode = 'customer' | 'captain' | null;

const customerSteps = ['اختيار الفرع', 'تصفح المنتجات', 'السلة والعنوان', 'تأكيد الطلب', 'متابعة الطلب'];
const captainSteps = ['طلبات جديدة', 'تم القبول', 'استلام من الفرع', 'في الطريق', 'تم التسليم'];

export default function App() {
  const [mode, setMode] = useState<Mode>(null);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.brand}>Johna S</Text>
        <Text style={styles.title}>تطبيق الطلب والتوصيل</Text>
        <Text style={styles.subtitle}>واجهة موبايل مستقلة مرتبطة بنفس نظام نقطة البيع</Text>

        {mode === null ? (
          <View style={styles.grid}>
            <ModeCard
              title="أنا عميل"
              description="تصفح المنيو، اطلب، وحدد عنوانك وتابع حالة الطلب."
              onPress={() => setMode('customer')}
            />
            <ModeCard
              title="أنا كابتن"
              description="استلم الطلبات المسندة إليك وحدّث حالة التوصيل."
              onPress={() => setMode('captain')}
            />
          </View>
        ) : (
          <View style={styles.panel}>
            <TouchableOpacity onPress={() => setMode(null)}>
              <Text style={styles.back}>‹ رجوع</Text>
            </TouchableOpacity>
            <Text style={styles.panelTitle}>{mode === 'customer' ? 'رحلة العميل' : 'رحلة الكابتن'}</Text>
            {(mode === 'customer' ? customerSteps : captainSteps).map((step, index) => (
              <View key={step} style={styles.step}>
                <Text style={styles.stepNumber}>{index + 1}</Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
            <Text style={styles.notice}>
              هذه النسخة هي طبقة الواجهة الأولى فقط. الربط القادم سيكون عبر Mobile Gateway آمن يحافظ على RLS وعزل الفروع ومنطق الطلب الحالي.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ModeCard({ title, description, onPress }: { title: string; description: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardText}>{description}</Text>
      <Text style={styles.open}>فتح ›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f6f7fb' },
  container: { padding: 24, gap: 18 },
  brand: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  title: { fontSize: 30, fontWeight: '800', textAlign: 'right' },
  subtitle: { fontSize: 15, lineHeight: 24, color: '#667085', textAlign: 'right' },
  grid: { gap: 14, marginTop: 10 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 22, minHeight: 170, justifyContent: 'space-between' },
  cardTitle: { fontSize: 24, fontWeight: '800', textAlign: 'right' },
  cardText: { fontSize: 15, lineHeight: 24, color: '#667085', textAlign: 'right' },
  open: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  panel: { backgroundColor: '#fff', borderRadius: 24, padding: 22, gap: 14 },
  back: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  panelTitle: { fontSize: 24, fontWeight: '800', textAlign: 'right', marginBottom: 4 },
  step: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 8 },
  stepNumber: { width: 34, height: 34, borderRadius: 17, textAlign: 'center', textAlignVertical: 'center', backgroundColor: '#eef0f4', fontWeight: '800' },
  stepText: { fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'right' },
  notice: { marginTop: 8, padding: 14, borderRadius: 16, backgroundColor: '#f7f8fa', color: '#667085', lineHeight: 22, textAlign: 'right' },
});
