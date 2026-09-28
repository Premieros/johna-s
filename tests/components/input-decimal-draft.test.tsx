import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Input } from '../../src/components/Input';

function ControlledNumber() {
  const [value, setValue] = useState(0);

  return (
    <>
      <Input
        aria-label="quantity"
        type="number"
        step="0.001"
        value={value}
        onChange={(event) => setValue(Number.parseFloat(event.target.value) || 0)}
      />
      <output data-testid="numeric-value">{value}</output>
    </>
  );
}

describe('Input controlled decimal draft', () => {
  it('preserves 0.050 while focused even when the parent stores 0.05', () => {
    render(<ControlledNumber />);

    const input = screen.getByLabelText('quantity') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.050' } });

    expect(input.value).toBe('0.050');
    expect(screen.getByTestId('numeric-value')).toHaveTextContent('0.05');
  });
});
