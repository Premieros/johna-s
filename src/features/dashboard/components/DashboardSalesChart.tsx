import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type DashboardSalesPoint = {
  label: string;
  sales: number;
  previous: number;
};

export function DashboardSalesChart({
  data,
  formatValue,
}: {
  data: DashboardSalesPoint[];
  formatValue: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => formatValue(Number(value || 0))} />
        <Area
          type="monotone"
          dataKey="sales"
          stroke="currentColor"
          fill="currentColor"
          fillOpacity={0.12}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
