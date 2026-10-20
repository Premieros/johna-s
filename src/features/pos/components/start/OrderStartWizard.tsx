import { useCan } from '@/lib/permissions';
import { ArrowRight, Table2, Car, Bike, Zap, ListOrdered } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { Customer, DiningTable, Order, OrderItem, OrderType } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { TablePickerStep } from './TablePickerStep';
import { CarOrderStep } from './CarOrderStep';
import { DeliveryOrderStep } from './DeliveryOrderStep';

export type StartStep = 'type' | 'table' | 'car' | 'delivery';

export interface StartOrderOptions {
  orderType: OrderType;
  tableId?: string | null;
  guestCount?: number | null;
  customerId?: string;
  notes?: string;
}

interface OrderStartWizardProps {
  step: StartStep;
  tables: DiningTable[];
  ordersByTable: Record<string, Order[]>;
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  customers: Customer[];
  preselectedTableId: string | null;
  currency: string;
  onStepChange: (step: StartStep) => void;
  onBack: () => void;
  onStart: (opts: StartOrderOptions) => void;
  onResume: (order: Order, pay?: boolean) => void;
  onActiveOrders: () => void;
}

const STEP_ICONS = { type: Table2, table: Table2, car: Car, delivery: Bike } as const;

export function OrderStartWizard({
  step,
  tables,
  ordersByTable,
  itemsByOrder,
  kitchenSendsByOrder,
  customers,
  preselectedTableId,
  currency,
  onStepChange,
  onBack,
  onStart,
  onResume,
  onActiveOrders,
}: OrderStartWizardProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const can = useCan();
  const canQuick = can('pos.order.create') || can('pos.order.quick_create');

  const startOrder = (options: StartOrderOptions) => {
    window.dispatchEvent(new Event('pos:order-flow-started'));
    onStart(options);
  };

  const title =
    step === 'type'
      ? (isAr ? 'اختر طاولة أو افتح طلبًا سريعًا' : 'Choose a table or start a quick order')
      : step === 'table'
        ? t('dineIn')
        : step === 'car'
          ? t('carOrder')
          : t('delivery');

  const showBack = step !== 'type';
  const StepIcon = STEP_ICONS[step];

  return (
    <div className="fixed inset-0 top-16 z-40 flex flex-col bg-ui-page animate-fade-in">
      <div className="shrink-0 border-b border-ui-border bg-ui-surface px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          {showBack ? (
            <button
              onClick={onBack}
              className="flex items-center gap-1 rounded-xl bg-ui-page-alt px-3 py-2 text-xs font-bold text-ui-muted transition active:scale-95"
            >
              <ArrowRight className={`h-3.5 w-3.5 ${isAr ? '' : 'rotate-180'}`} />
              {isAr ? 'رجوع' : 'Back'}
            </button>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ui-primary-soft">
              <StepIcon className="h-5 w-5 text-ui-accent" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-black text-ui-text">{title}</h2>
            {step === 'type' && (
              <p className="mt-0.5 text-[10px] font-bold text-ui-subtle">
                {isAr ? 'الطاولات هي نقطة البداية — أو اختر نوع طلب مباشر' : 'Tables are the starting point — or choose a direct order type'}
              </p>
            )}
          </div>
        </div>

        {step === 'type' && (
          <div data-testid="pos-landing-actions" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              data-testid="pos-start-quick"
              disabled={!canQuick}
              onClick={() => startOrder({ orderType: 'takeaway' })}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-ui-border bg-ui-surface-raised px-4 text-start shadow-ui-xs transition hover:border-ui-primary hover:bg-ui-primary-soft active:scale-[.98]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ui-primary-soft text-ui-accent"><Zap className="h-5 w-5" /></span>
              <span><span className="block text-sm font-black text-ui-text">{isAr ? 'طلب سريع' : 'Quick order'}</span><span className="text-[10px] font-bold text-ui-subtle">{isAr ? 'تيك أواي مباشر' : 'Takeaway'}</span></span>
            </button>
            <button
              type="button"
              data-testid="pos-start-delivery"
              disabled={!can('pos.order.create')}
              onClick={() => onStepChange('delivery')}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-ui-border bg-ui-surface-raised px-4 text-start shadow-ui-xs transition hover:border-ui-primary hover:bg-ui-primary-soft active:scale-[.98]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ui-info/10 text-ui-info"><Bike className="h-5 w-5" /></span>
              <span><span className="block text-sm font-black text-ui-text">{isAr ? 'دليفري' : 'Delivery'}</span><span className="text-[10px] font-bold text-ui-subtle">{isAr ? 'طلب توصيل' : 'Delivery order'}</span></span>
            </button>
            <button
              type="button"
              data-testid="pos-start-drive-thru"
              onClick={() => onStepChange('car')}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-ui-border bg-ui-surface-raised px-4 text-start shadow-ui-xs transition hover:border-ui-primary hover:bg-ui-primary-soft active:scale-[.98]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ui-warning/10 text-ui-warning"><Car className="h-5 w-5" /></span>
              <span><span className="block text-sm font-black text-ui-text">{isAr ? 'درايف ثرو' : 'Drive thru'}</span><span className="text-[10px] font-bold text-ui-subtle">{isAr ? 'طلب سيارة' : 'Car order'}</span></span>
            </button>
            <button
              type="button"
              data-testid="pos-start-active-orders"
              onClick={onActiveOrders}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-ui-border bg-ui-surface-raised px-4 text-start shadow-ui-xs transition hover:border-ui-primary hover:bg-ui-primary-soft active:scale-[.98]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ui-page-alt text-ui-muted"><ListOrdered className="h-5 w-5" /></span>
              <span><span className="block text-sm font-black text-ui-text">{isAr ? 'الطلبات النشطة' : 'Active orders'}</span><span className="text-[10px] font-bold text-ui-subtle">{isAr ? 'استئناف أو دفع' : 'Resume or pay'}</span></span>
            </button>
          </div>
        )}
      </div>

      {(step === 'type' || step === 'table') && (
        <TablePickerStep
          tables={tables}
          ordersByTable={ordersByTable}
          itemsByOrder={itemsByOrder}
          kitchenSendsByOrder={kitchenSendsByOrder}
          currency={currency}
          preselectedTableId={preselectedTableId}
          onStart={(table, guests) => startOrder({ orderType: 'dine_in', tableId: table.id, guestCount: guests })}
          onResume={onResume}
          onPay={(order) => onResume(order, true)}
        />
      )}
      {step === 'car' && <CarOrderStep onStart={(options) => startOrder({ ...options })} />}
      {step === 'delivery' && <DeliveryOrderStep customers={customers} onStart={(options) => startOrder({ ...options })} />}
    </div>
  );
}
