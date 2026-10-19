import type { ReactNode } from 'react';
import { WalletCards } from 'lucide-react';

export function BrandMark({className = ''}: {className?: string}) {
  return <span aria-hidden="true" className={`brand-mark ${className}`}><WalletCards size={22} strokeWidth={1.7} /></span>;
}

export function ScreenHeader({title,eyebrow,actions}: {title:string;eyebrow:string;actions?:ReactNode}) {
  return <header className="screen-header"><div className="min-w-0"><p className="eyebrow">{eyebrow}</p><h1 className="screen-title">{title}</h1></div>{actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}</header>;
}
