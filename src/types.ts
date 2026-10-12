export type TransactionType = 'income' | 'expense';
export type TransactionKind = 'cashflow' | 'transfer' | 'goal_deposit' | 'goal_release';
export type AccountKind = 'bank' | 'cash' | 'savings';

export interface Account {
  id: string;
  household_id: string;
  name: string;
  kind: AccountKind;
  currency: 'BYN';
  opening_balance: number;
  is_archived: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string; // Lucide icon name, e.g., 'Utensils', 'Home', etc.
  color: string; // Tailwind text color class, e.g., 'text-emerald-400'
  bgColor: string; // Tailwind background color class, e.g., 'bg-emerald-500/10'
  borderColor: string; // Tailwind border color class, e.g., 'border-emerald-500/20'
  accentColor: string; // Hex color for Recharts or custom inline styles
}

export interface FamilyMember {
  id: string;
  name: string;
  avatar: string; // Emoji avatar or initial
  color: string; // CSS color string or class
}

export interface RecurringTransaction {
  id: string;
  household_id: string;
  added_by: string | null;
  type: TransactionType;
  amount: number;
  category_id: string;
  comment: string;
  day_of_month: number; // 1-28
  last_applied: string | null; // ISO date YYYY-MM-DD
  is_active: boolean;
  created_at: string;
}

export interface SavingsGoal {
  id: string;
  household_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  emoji: string;
  deadline: string | null; // ISO date YYYY-MM-DD
  is_completed: boolean;
  is_archived?: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  comment: string;
  addedBy: string; // FamilyMember ID
  kind?: TransactionKind;
  accountId?: string | null;
  targetAccountId?: string | null;
  goalId?: string | null;
  recurringId?: string | null;
  incomeDistributionId?: string | null;
}

export interface CategoryBudget {
  id: string;
  household_id: string;
  month: string;
  category_id: string;
  allocated_amount: number;
  created_at: string;
  updated_at: string;
}

export interface IncomeAllocation {
  targetType: 'budget' | 'goal';
  targetId: string;
  amount: number;
}

export interface IncomeDistribution {
  id: string;
  household_id: string;
  income_transaction_id: string;
  month: string;
  total_amount: number;
  items: IncomeAllocation[];
  created_by: string;
  created_at: string;
}

export interface AppState {
  transactions: Transaction[];
  categories: Category[];
  members: FamilyMember[];
  balance: number;
  monthlyIncome: number;
  monthlyExpense: number;
}
