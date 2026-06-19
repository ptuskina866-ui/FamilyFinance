import { Category, FamilyMember, Transaction } from './types';

export const INITIAL_MEMBERS: FamilyMember[] = [
  { id: 'dad', name: 'Дмитрий', avatar: '👨', color: '#3b82f6' },
  { id: 'mom', name: 'Елена', avatar: '👩', color: '#ec4899' },
  { id: 'son', name: 'Артём', avatar: '👦', color: '#10b981' }
];

export const CATEGORIES: Category[] = [
  // Расходы
  {
    id: 'food',
    name: 'Еда',
    icon: 'Utensils',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'housing',
    name: 'Жилье',
    icon: 'Home',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    accentColor: '#3b82f6'
  },
  {
    id: 'car',
    name: 'Авто',
    icon: 'Car',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    accentColor: '#f59e0b'
  },
  {
    id: 'education',
    name: 'Учеба',
    icon: 'GraduationCap',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/20',
    accentColor: '#8b5cf6'
  },
  {
    id: 'entertainment',
    name: 'Развлечения',
    icon: 'Sparkles',
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10',
    borderColor: 'border-pink-500/20',
    accentColor: '#ec4899'
  },
  {
    id: 'other',
    name: 'Другое',
    icon: 'HelpCircle',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/20',
    accentColor: '#94a3b8'
  },
  // Доходы (специальные категории)
  {
    id: 'salary',
    name: 'Зарплата',
    icon: 'Briefcase',
    color: 'text-teal-400',
    bgColor: 'bg-teal-500/10',
    borderColor: 'border-teal-500/20',
    accentColor: '#14b8a6'
  },
  {
    id: 'income-other',
    name: 'Доп. доход',
    icon: 'TrendingUp',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/20',
    accentColor: '#06b6d4'
  }
];

// Helper to get date relative to current month/day
const getRelativeDateString = (offsetDays: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  return date.toISOString().split('T')[0];
};

export const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-1',
    type: 'income',
    amount: 3200,
    categoryId: 'salary',
    date: getRelativeDateString(10),
    comment: 'Зарплата Папы',
    addedBy: 'dad'
  },
  {
    id: 'tx-2',
    type: 'income',
    amount: 2800,
    categoryId: 'salary',
    date: getRelativeDateString(9),
    comment: 'Зарплата Мамы',
    addedBy: 'mom'
  },
  {
    id: 'tx-3',
    type: 'expense',
    amount: 850,
    categoryId: 'housing',
    date: getRelativeDateString(8),
    comment: 'Аренда квартиры + коммуналка',
    addedBy: 'dad'
  },
  {
    id: 'tx-4',
    type: 'expense',
    amount: 145.5,
    categoryId: 'food',
    date: getRelativeDateString(6),
    comment: 'Продукты в Гиппо',
    addedBy: 'mom'
  },
  {
    id: 'tx-5',
    type: 'expense',
    amount: 90,
    categoryId: 'car',
    date: getRelativeDateString(5),
    comment: 'Заправка АИ-95',
    addedBy: 'dad'
  },
  {
    id: 'tx-6',
    type: 'expense',
    amount: 320,
    categoryId: 'education',
    date: getRelativeDateString(4),
    comment: 'Курсы английского языка',
    addedBy: 'son'
  },
  {
    id: 'tx-7',
    type: 'expense',
    amount: 75.8,
    categoryId: 'food',
    date: getRelativeDateString(3),
    comment: 'Ужин в ресторане Васильки',
    addedBy: 'mom'
  },
  {
    id: 'tx-8',
    type: 'expense',
    amount: 110,
    categoryId: 'entertainment',
    date: getRelativeDateString(2),
    comment: 'Билеты в кино и боулинг',
    addedBy: 'son'
  },
  {
    id: 'tx-9',
    type: 'expense',
    amount: 35,
    categoryId: 'other',
    date: getRelativeDateString(1),
    comment: 'Аптека',
    addedBy: 'mom'
  },
  {
    id: 'tx-10',
    type: 'income',
    amount: 150,
    categoryId: 'income-other',
    date: getRelativeDateString(0),
    comment: 'Кэшбэк по карте',
    addedBy: 'dad'
  }
];
