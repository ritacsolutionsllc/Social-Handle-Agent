import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50 disabled:text-rose-300',
};

export function Button({ variant = 'primary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm',
        variants[variant],
        className,
      )}
    />
  );
}

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cn('rounded-xl bg-white shadow-sm ring-1 ring-slate-200', className)} />;
}

export function Badge({ tone = 'slate', children, className, title }: { tone?: 'slate' | 'green' | 'red' | 'amber' | 'orange' | 'indigo' | 'violet'; children: ReactNode; className?: string; title?: string }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    red: 'bg-rose-50 text-rose-800 ring-rose-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    orange: 'bg-orange-50 text-orange-800 ring-orange-200',
    indigo: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
    violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  } as const;
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error'; title?: string; children: ReactNode }) {
  const t = { info: 'bg-indigo-50 text-indigo-900 ring-indigo-200', warn: 'bg-amber-50 text-amber-900 ring-amber-200', error: 'bg-rose-50 text-rose-900 ring-rose-200' }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-lg px-4 py-3 text-sm ring-1', t)}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}
