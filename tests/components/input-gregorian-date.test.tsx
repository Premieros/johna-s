import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Input } from '@/components/Input';

function DateFilter() {
  const [date, setDate] = useState('2026-10-16');
  return <div lang="ar-SA" dir="rtl">
    <Input label="من تاريخ" type="date" min="2026-10-01" max="2026-10-31"
      value={date} onChange={event => setDate(event.target.value)} />
    <output data-testid="iso-date">{date}</output>
  </div>;
}

describe('Gregorian date input', () => {
  it('keeps ISO filter values and constraints inside an Arabic locale', () => {
    render(<DateFilter />);
    const input = screen.getByLabelText('من تاريخ') as HTMLInputElement;
    expect(input.lang).toBe('en-GB-u-ca-gregory');
    expect(input.dir).toBe('ltr');
    expect(input.value).toBe('2026-10-16');
    expect(input.min).toBe('2026-10-01');
    expect(input.max).toBe('2026-10-31');
    fireEvent.change(input, { target: { value: '2026-10-20' } });
    expect(screen.getByTestId('iso-date')).toHaveTextContent('2026-10-20');
  });

  it('preserves explicit language/direction on ordinary text fields', () => {
    render(<Input label="اسم" lang="ar" dir="rtl" defaultValue="سموحة" />);
    const input = screen.getByLabelText('اسم') as HTMLInputElement;
    expect(input.lang).toBe('ar');
    expect(input.dir).toBe('rtl');
  });
});
