import { type ReactNode } from 'react';
import premierLogo from '../assets/brand/premier-os-logo.webp';

export type LogoTone = 'navy' | 'white' | 'mono' | 'auto';
export type LogoVariant = 'mark' | 'horizontal' | 'vertical';

interface LogoProps {
  size?: number;
  variant?: LogoVariant;
  showTagline?: boolean;
  tone?: LogoTone;
  tagline?: string;
  className?: string;
}

/** Display the supplied artwork unchanged, framing only its geometric P mark. */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="350 255 600 640"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="shrink-0 rounded-lg">
      <image href={premierLogo} width="1254" height="1254" />
    </svg>
  );
}

export function Logo({
  size = 32,
  variant = 'mark',
  showTagline = true,
  tone = 'auto',
  tagline = 'Business Management Platform',
  className = '',
}: LogoProps) {
  const textCls =
    tone === 'white'
      ? 'text-[#F6F3ED]'
      : tone === 'mono'
        ? 'text-current'
        : 'text-ui-text';

  const mark = <Mark size={size} />;

  const textBlock = (
    <div className="flex flex-col" dir="ltr">
      <span
        className={`font-bold tracking-tight leading-none ${textCls}`}
        style={{ fontSize: Math.round(size * 0.42) }}
      >
        premier<span className="text-[#7545EF]">.</span>os
      </span>
      {showTagline && (
        <span
          className="uppercase tracking-[0.16em] text-ui-subtle mt-1 leading-none"
          style={{ fontSize: Math.max(8, Math.round(size * 0.125)) }}
        >
          {tagline}
        </span>
      )}
    </div>
  );

  let content: ReactNode;
  if (variant === 'mark') {
    content = <div className={className} role="img" aria-label="premier.os">{mark}</div>;
  } else if (variant === 'horizontal') {
    content = (
      <div className={`flex items-center gap-3 ${className}`} dir="ltr">
        {mark}
        {textBlock}
      </div>
    );
  } else {
    content = (
      <div className={`flex flex-col items-center gap-2 ${className}`} dir="ltr">
        {mark}
        {textBlock}
      </div>
    );
  }

  return <>{content}</>;
}
