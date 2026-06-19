import React, { createContext, useContext, useState, useEffect } from 'react';
import { Transaction, Category, FamilyMember, RecurringTransaction, SavingsGoal } from './types';
import { CATEGORIES } from './mockData';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';

interface AppContextType {
  transactions: Transaction[];
  categories: Category[];
  members: FamilyMember[];
  balance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  budgetLimit: number;
  recurringTransactions: RecurringTransaction[];
  savingsGoals: SavingsGoal[];
  addTransaction: (tx: Omit<Transaction, 'id'>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  setBudgetLimit: (limit: number) => void;
  getCategoryById: (id: string) => Category | undefined;
  getMemberById: (id: string) => FamilyMember | undefined;
  addRecurring: (data: Omit<RecurringTransaction, 'id' | 'household_id' | 'last_applied' | 'is_active' | 'created_at'>) => Promise<void>;
  deleteRecurring: (id: string) => Promise<void>;
  addGoal: (data: Pick<SavingsGoal, 'name' | 'target_amount' | 'emoji' | 'deadline'>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  updateGoalAmount: (goalId: string, addAmount: number) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [budgetLimit, setBudgetLimitState] = useState<number>(1500);
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);

  // 1. Fetch household members
  useEffect(() => {
    if (!profile?.household_id) { setMembers([]); return; }

    const fetchHouseholdMembers = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, avatar, color')
        .eq('household_id', profile.household_id);
      if (!error && data) setMembers(data as FamilyMember[]);
    };

    fetchHouseholdMembers();

    const channel = supabase
      .channel(`household-members-${profile.household_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `household_id=eq.${profile.household_id}` }, fetchHouseholdMembers)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.household_id]);

  // 2. Fetch & subscribe transactions
  useEffect(() => {
    if (!profile?.household_id) { setTransactions([]); return; }

    const fetchTransactions = async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('household_id', profile.household_id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (!error && data) {
        setTransactions(data.map((t: any) => ({
          id: t.id, type: t.type, amount: Number(t.amount),
          categoryId: t.category_id, comment: t.comment || '',
          addedBy: t.added_by, date: t.date
        })));
      }
    };

    fetchTransactions();

    const channel = supabase
      .channel(`household-transactions-${profile.household_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${profile.household_id}` }, fetchTransactions)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.household_id]);

  // 3. Fetch recurring transactions
  useEffect(() => {
    if (!profile?.household_id) { setRecurringTransactions([]); return; }

    const fetchRecurring = async () => {
      const { data, error } = await supabase
        .from('recurring_transactions')
        .select('*')
        .eq('household_id', profile.household_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (!error && data) setRecurringTransactions(data as RecurringTransaction[]);
    };

    fetchRecurring();
  }, [profile?.household_id]);

  // 4. Auto-apply recurring transactions for current month
  useEffect(() => {
    if (!profile?.household_id || recurringTransactions.length === 0) return;

    const applyRecurring = async () => {
      const today = new Date();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();

      for (const rec of recurringTransactions) {
        if (currentDay < rec.day_of_month) continue;

        const lastApplied = rec.last_applied ? new Date(rec.last_applied) : null;
        const alreadyApplied = lastApplied &&
          lastApplied.getFullYear() === currentYear &&
          (lastApplied.getMonth() + 1) === currentMonth;

        if (alreadyApplied) continue;

        const scheduledDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(rec.day_of_month).padStart(2, '0')}`;

        const { error: txError } = await supabase.from('transactions').insert({
          type: rec.type, amount: rec.amount, category_id: rec.category_id,
          comment: rec.comment || '',
          added_by: rec.added_by,
          household_id: profile.household_id,
          date: scheduledDate
        });

        if (!txError) {
          await supabase.from('recurring_transactions')
            .update({ last_applied: scheduledDate })
            .eq('id', rec.id);
        }
      }
    };

    applyRecurring();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.household_id, recurringTransactions.length]);

  // 5. Fetch savings goals
  useEffect(() => {
    if (!profile?.household_id) { setSavingsGoals([]); return; }

    const fetchGoals = async () => {
      const { data, error } = await supabase
        .from('savings_goals')
        .select('*')
        .eq('household_id', profile.household_id)
        .order('created_at', { ascending: false });
      if (!error && data) setSavingsGoals(data as SavingsGoal[]);
    };

    fetchGoals();
  }, [profile?.household_id]);

  // 6. Budget limit from localStorage
  useEffect(() => {
    const savedLimit = localStorage.getItem('ff_budget_limit');
    if (savedLimit) setBudgetLimitState(Number(savedLimit));
    else localStorage.setItem('ff_budget_limit', '1500');
  }, []);

  const addTransaction = async (tx: Omit<Transaction, 'id'>) => {
    if (!profile?.household_id) return;
    const { error } = await supabase.from('transactions').insert({
      type: tx.type, amount: tx.amount, category_id: tx.categoryId,
      comment: tx.comment, added_by: tx.addedBy,
      household_id: profile.household_id, date: tx.date
    });
    if (error) { console.error(error); alert('Ошибка: ' + error.message); }
  };

  const deleteTransaction = async (id: string) => {
    if (!profile?.household_id) {
      console.error('deleteTransaction: no household_id in profile');
      return;
    }

    // Оптимистичное обновление: сразу убираем из локального состояния
    const previousTransactions = transactions;
    setTransactions(prev => prev.filter(t => t.id !== id));

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('household_id', profile.household_id);

    if (error) {
      // Откат: восстанавливаем предыдущее состояние
      console.error('DELETE error:', error);
      setTransactions(previousTransactions);
      alert('Ошибка удаления: ' + error.message);
    }
  };

  const addRecurring = async (data: Omit<RecurringTransaction, 'id' | 'household_id' | 'last_applied' | 'is_active' | 'created_at'>) => {
    if (!profile?.household_id) return;
    const { data: inserted, error } = await supabase.from('recurring_transactions').insert({
      ...data, household_id: profile.household_id, is_active: true
    }).select().single();
    if (error) { console.error(error); throw error; }
    if (inserted) setRecurringTransactions(prev => [inserted as RecurringTransaction, ...prev]);
  };

  const deleteRecurring = async (id: string) => {
    const { error } = await supabase.from('recurring_transactions').delete().eq('id', id);
    if (!error) setRecurringTransactions(prev => prev.filter(r => r.id !== id));
  };

  const addGoal = async (data: Pick<SavingsGoal, 'name' | 'target_amount' | 'emoji' | 'deadline'>) => {
    if (!profile?.household_id) return;
    const { data: inserted, error } = await supabase.from('savings_goals').insert({
      ...data, household_id: profile.household_id, current_amount: 0, is_completed: false
    }).select().single();
    if (error) { console.error(error); throw error; }
    if (inserted) setSavingsGoals(prev => [inserted as SavingsGoal, ...prev]);
  };

  const deleteGoal = async (id: string) => {
    const { error } = await supabase.from('savings_goals').delete().eq('id', id);
    if (!error) setSavingsGoals(prev => prev.filter(g => g.id !== id));
  };

  const updateGoalAmount = async (goalId: string, addAmount: number) => {
    const goal = savingsGoals.find(g => g.id === goalId);
    if (!goal) return;
    const newAmount = goal.current_amount + addAmount;
    const isCompleted = newAmount >= goal.target_amount;
    const { error } = await supabase.from('savings_goals')
      .update({ current_amount: newAmount, is_completed: isCompleted })
      .eq('id', goalId);
    if (!error) setSavingsGoals(prev => prev.map(g =>
      g.id === goalId ? { ...g, current_amount: newAmount, is_completed: isCompleted } : g
    ));
  };

  const setBudgetLimit = (limit: number) => {
    setBudgetLimitState(limit);
    localStorage.setItem('ff_budget_limit', limit.toString());
  };

  const getCategoryById = (id: string) => CATEGORIES.find(c => c.id === id);
  const getMemberById = (id: string) => members.find(m => m.id === id);

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const currentMonthTransactions = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const monthlyIncome = currentMonthTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthlyExpense = currentMonthTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = transactions.reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0);

  return (
    <AppContext.Provider value={{
      transactions, categories: CATEGORIES, members, balance,
      monthlyIncome, monthlyExpense, budgetLimit,
      recurringTransactions, savingsGoals,
      addTransaction, deleteTransaction, setBudgetLimit,
      getCategoryById, getMemberById,
      addRecurring, deleteRecurring,
      addGoal, deleteGoal, updateGoalAmount
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
