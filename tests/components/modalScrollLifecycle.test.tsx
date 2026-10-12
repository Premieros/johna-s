import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '@/components/Modal';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('nested modal scrolling lifecycle', () => {
  it('keeps the page locked when the first dialog closes before the second', () => {
    document.body.style.overflow = 'auto';
    const view = render(<><Modal open onClose={() => {}} title="First">First body</Modal><Modal open onClose={() => {}} title="Second">Second body</Modal></>);
    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(<><Modal open={false} onClose={() => {}} title="First">First body</Modal><Modal open onClose={() => {}} title="Second">Second body</Modal></>);
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('closes only the top dialog on Escape and keeps lock ownership across callback changes', () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const view = render(<><Modal open onClose={firstClose} title="First">First body</Modal><Modal open onClose={secondClose} title="Second">Second body</Modal></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);
    const latestClose = vi.fn();
    view.rerender(<><Modal open onClose={latestClose} title="First">First body</Modal><Modal open={false} onClose={secondClose} title="Second">Second body</Modal></>);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(latestClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('portals outside constrained ancestors and retains a bounded dialog scroll body', () => {
    const view = render(<div style={{ transform: 'translateZ(0)', overflow: 'hidden' }}><Modal open onClose={() => {}} title="Details"><div>Content</div></Modal></div>);
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(view.container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByTestId('modal-body').className).toContain('overflow-y-auto');
    expect(dialog.className).toContain('overflow-hidden');
  });
});
