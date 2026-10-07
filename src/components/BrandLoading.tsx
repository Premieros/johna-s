import { Logo } from '@/components/Logo';

/** Decorative branded feedback; the surrounding loading state owns its announcement. */
export function BrandLoading({ size = 64 }: { size?: number }) {
  return (
    <span className="premier-wait" style={{ width: size, height: size }} aria-hidden="true">
      <span className="premier-wait-mark"><Logo size={size} variant="mark" /></span>
      <span className="premier-wait-orbit" />
    </span>
  );
}
