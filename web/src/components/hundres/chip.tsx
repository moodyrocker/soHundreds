import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

type ChipVariant = 'default' | 'accent' | 'success' | 'warn';

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  children: ReactNode;
}

export function Chip({ variant = 'default', className, children, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        'chip',
        variant === 'accent' && 'chip-accent',
        variant === 'success' && 'chip-success',
        variant === 'warn' && 'chip-warn',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
