import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tight?: boolean;
  flush?: boolean;
  children: ReactNode;
}

export function Card({ tight, flush, className, children, ...props }: CardProps) {
  return (
    <div className={cn('card', tight && 'card-tight', flush && 'card-flush', className)} {...props}>
      {children}
    </div>
  );
}
