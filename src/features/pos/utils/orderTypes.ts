import type { DiningTableStatus, OrderType } from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n';

export const ORDER_TYPE_KEY: Record<OrderType, TranslationKey> = {
  dine_in: 'dineIn',
  takeaway: 'takeaway',
  delivery: 'delivery',
  drive_thru: 'driveThru',
} as const;

export const ORDER_TYPES: readonly OrderType[] = ['dine_in', 'takeaway', 'delivery', 'drive_thru'] as const;

export interface TableStatusStyle {
  label: DiningTableStatus;
  card: string;
  badge: string;
  dot: string;
}

export const STATUS_STYLES: Record<DiningTableStatus, TableStatusStyle> = {
  vacant: { label: 'vacant', card: 'border-ui-success/70 bg-ui-success/15', badge: 'bg-ui-success-soft text-ui-success border border-ui-success/30', dot: 'bg-ui-success' },
  occupied: { label: 'occupied', card: 'border-ui-warning/80 bg-ui-warning/20', badge: 'bg-ui-warning-soft text-ui-warning border border-ui-warning/35', dot: 'bg-ui-warning' },
  reserved: { label: 'reserved', card: 'border-ui-info/70 bg-ui-info/20', badge: 'bg-ui-info-soft text-ui-info border border-ui-info/30', dot: 'bg-ui-info' },
  closed: { label: 'closed', card: 'border-ui-border-strong bg-ui-page-alt', badge: 'bg-ui-page-alt text-ui-muted border border-ui-border-strong', dot: 'bg-ui-subtle' },
};
