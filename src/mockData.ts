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
    id: 'food-hippo',
    name: 'Гиппо',
    icon: 'ShoppingCart',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'food-euroopt',
    name: 'Евроопт',
    icon: 'ShoppingCart',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'food-green',
    name: 'Green',
    icon: 'Leaf',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#22c55e'
  },
  {
    id: 'food-fixprice',
    name: 'FixPrice',
    icon: 'Tag',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'food-groshyk',
    name: 'Грошик',
    icon: 'Coins',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'food-mayak',
    name: 'Маяк',
    icon: 'Store',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'food-santa',
    name: 'Санта',
    icon: 'ShoppingCart',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'food-sosedi',
    name: 'Соседи',
    icon: 'ShoppingCart',
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
    id: 'marketplaces',
    name: 'Маркетплейсы',
    icon: 'ShoppingBag',
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/20',
    accentColor: '#ec4899'
  },
  {
    id: 'utilities',
    name: 'Коммунальные платежи',
    icon: 'Receipt',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    accentColor: '#3b82f6'
  },
  {
    id: 'scooters',
    name: 'Поездка на самокатах',
    icon: 'Bike',
    color: 'text-lime-400',
    bgColor: 'bg-lime-500/10',
    borderColor: 'border-lime-500/20',
    accentColor: '#84cc16'
  },
  {
    id: 'mobile',
    name: 'Мобильная связь',
    icon: 'Phone',
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/20',
    accentColor: '#0ea5e9'
  },
  {
    id: 'credit',
    name: 'Кредит',
    icon: 'Percent',
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/20',
    accentColor: '#f43f5e'
  },
  {
    id: 'water',
    name: 'Вода',
    icon: 'Droplet',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/20',
    accentColor: '#06b6d4'
  },
  {
    id: 'medical',
    name: 'Аптека и медицина',
    icon: 'Pill',
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/20',
    accentColor: '#f43f5e'
  },
  {
    id: 'beauty',
    name: 'Салон красоты',
    icon: 'Scissors',
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10',
    borderColor: 'border-pink-500/20',
    accentColor: '#ec4899'
  },
  {
    id: 'transport',
    name: 'Такси и транспорт',
    icon: 'Bus',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    accentColor: '#f59e0b'
  },
  {
    id: 'clothes',
    name: 'Одежда и обувь',
    icon: 'Shirt',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    accentColor: '#a855f7'
  },
  {
    id: 'household',
    name: 'Товары для дома',
    icon: 'Home',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    accentColor: '#3b82f6'
  },
  {
    id: 'pets',
    name: 'Питомцы',
    icon: 'Cat',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    accentColor: '#f97316'
  },
  {
    id: 'electronics',
    name: 'Техника и гаджеты',
    icon: 'Smartphone',
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500/20',
    accentColor: '#6366f1'
  },
  {
    id: 'cafes',
    name: 'Кафе и рестораны',
    icon: 'Coffee',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/20',
    accentColor: '#eab308'
  },
  {
    id: 'gifts',
    name: 'Подарки и праздники',
    icon: 'Gift',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'internet',
    name: 'Связь и интернет',
    icon: 'Wifi',
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/20',
    accentColor: '#0ea5e9'
  },
  {
    id: 'taxes',
    name: 'Налоги и страховки',
    icon: 'FileText',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/20',
    accentColor: '#64748b'
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
  {
    id: 'savings',
    name: 'Накопления',
    icon: 'Target',
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500/20',
    accentColor: '#6366f1'
  },
  {
    id: 'cash',
    name: 'Снятие наличных',
    icon: 'Banknote',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'transfer',
    name: 'Перевод',
    icon: 'ArrowRightLeft',
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500/20',
    accentColor: '#6366f1'
  },
  // Доходы (специальные категории)
  {
    id: 'salary',
    name: 'Зарплата',
    icon: 'Briefcase',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    accentColor: '#10b981'
  },
  {
    id: 'income-transfer',
    name: 'Перевод на карту',
    icon: 'ArrowDownLeft',
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500/20',
    accentColor: '#6366f1'
  },
  {
    id: 'income-cashback',
    name: 'Кэшбэк и бонусы',
    icon: 'Sparkles',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    accentColor: '#f59e0b'
  },
  {
    id: 'income-freelance',
    name: 'Подработка',
    icon: 'Laptop',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    accentColor: '#3b82f6'
  },
  {
    id: 'income-other',
    name: 'Прочий доход',
    icon: 'TrendingUp',
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/20',
    accentColor: '#06b6d4'
  },
  {
    id: 'income-relatives',
    name: 'Помощь близких',
    icon: 'Heart',
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/20',
    accentColor: '#f43f5e'
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
