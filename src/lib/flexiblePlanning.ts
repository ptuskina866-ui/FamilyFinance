import type { BudgetRolloverMode, CategoryBudget, IncomeAllocation, IncomeDistribution, IncomeTemplateItem, SavingsGoal, Transaction } from '../types';
import { budgetProgress, planningDateISO, validateBudgetScopes } from './planning';
import { fromMinorUnits, sumMoney, toMinorUnits } from './money';
import { isCashflow } from './finance';

export function previousPlanningMonth(today = planningDateISO()): string {
  const [year,month] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year,month-2,1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-01`;
}
export function transferBudgetPreview(budgets: readonly CategoryBudget[], transactions: readonly Transaction[], from: string, to: string, amount: number, month: string): CategoryBudget[] {
  const cents = toMinorUnits(amount);
  const source = budgets.find(b => b.month === month && b.category_id === from);
  if (!source || from === to || cents <= 0 || toMinorUnits(budgetProgress(source,transactions).remaining) < cents) throw new Error('Выберите разные категории и сумму в пределах остатка.');
  const target = budgets.find(b => b.month === month && b.category_id === to) || {...source,id:`preview:${to}`,category_id:to,allocated_amount:0};
  const nextSource = {...source,allocated_amount:fromMinorUnits(toMinorUnits(source.allocated_amount)-cents)};
  const nextTarget = {...target,allocated_amount:fromMinorUnits(Math.max(toMinorUnits(target.allocated_amount),toMinorUnits(budgetProgress(target,transactions).spent))+cents)};
  const result = [...budgets.filter(b => b.id !== source.id && b.id !== target.id),nextSource,nextTarget];
  validateBudgetScopes(result,to,nextTarget.allocated_amount,month);
  return result;
}
/** Priority is array order; percentages use posted income, rounded down to a kopeck. */
export function resolveIncomeTemplate(items: readonly IncomeTemplateItem[], income: number, available: number) {
  if (!items.length || items.length > 32) throw new Error('Добавьте от 1 до 32 назначений.');
  const incomeCents = toMinorUnits(income);
  if(incomeCents<=0)throw new Error('Выберите положительный полученный доход.');
  let left = Math.max(0,Math.min(incomeCents,toMinorUnits(available)));
  const allocations: IncomeAllocation[] = [];
  const shortfalls: {targetType: IncomeAllocation['targetType']; targetId: string; amount: number}[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = toMinorUnits(item.value);
    const key = `${item.targetType}:${item.targetId}`;
    if (!['goal','budget'].includes(item.targetType) || !['fixed','percent'].includes(item.mode) || !item.targetId || item.targetId !== item.targetId.trim() || seen.has(key) || value <= 0 || (item.mode === 'percent' && value > 10000)) throw new Error('Проверьте назначения, суммы и проценты шаблона.');
    seen.add(key);
    const requested = item.mode === 'fixed' ? value : Number(BigInt(incomeCents)*BigInt(value)/10000n);
    const funded = Math.min(requested,left); left -= funded;
    if (funded > 0) allocations.push({targetType:item.targetType,targetId:item.targetId,amount:fromMinorUnits(funded)});
    if (funded < requested) shortfalls.push({targetType:item.targetType,targetId:item.targetId,amount:fromMinorUnits(requested-funded)});
  }
  return {allocations,shortfalls,total:sumMoney(allocations.map(i=>i.amount)),unassigned:fromMinorUnits(left)};
}
export function emergencyTarget(monthly: number, months: number): number {
  if (!Number.isInteger(months) || months < 1 || months > 12 || toMinorUnits(monthly) <= 0) throw new Error('Укажите необходимые расходы и срок от 1 до 12 месяцев.');
  return fromMinorUnits(toMinorUnits(monthly)*months);
}
export function emergencyCoverage(goal: SavingsGoal): number | null {
  if (goal.purpose !== 'emergency' || !goal.essential_amount || goal.essential_amount <= 0) return null;
  return Math.floor(toMinorUnits(goal.current_amount)*10/toMinorUnits(goal.essential_amount))/10;
}
/** Cancel only the reservation still available now. Already posted expenses remain intact. */
export function distributionRefund(distribution: IncomeDistribution, budgets: readonly CategoryBudget[], goals: readonly SavingsGoal[], transactions: readonly Transaction[]) {
  if (distribution.status === 'cancelled') return [];
  return distribution.items.map(item => {
    let refundable = 0;
    if (item.targetType === 'budget') {
      const budget = budgets.find(b => b.month === distribution.month && b.category_id === item.targetId);
      if (budget) refundable = Math.min(toMinorUnits(item.amount),toMinorUnits(budgetProgress(budget,transactions).remaining));
    } else {
      const goal=goals.find(g => g.id === item.targetId && !g.is_archived);
      const linked=transactions.filter(t => t.incomeDistributionId === distribution.id && t.goalId === item.targetId).reduce((sum,t)=>sum+(t.kind === 'goal_deposit' ? toMinorUnits(t.amount) : t.kind === 'goal_release' ? -toMinorUnits(t.amount) : 0),0);
      if (goal) refundable = Math.max(0,Math.min(toMinorUnits(item.amount),toMinorUnits(goal.current_amount),linked));
    }
    return {targetType:item.targetType,targetId:item.targetId,amount:fromMinorUnits(refundable)};
  });
}
export function previousBudgetReview(budgets: readonly CategoryBudget[], transactions: readonly Transaction[], mode: BudgetRolloverMode, today=planningDateISO()): IncomeAllocation[] {
  return budgets.filter(b => b.month === previousPlanningMonth(today)).sort((a,b)=>a.category_id < b.category_id ? -1 : a.category_id > b.category_id ? 1 : 0)
    .map(b=>({targetType:'budget' as const,targetId:b.category_id,amount:mode === 'repeat' ? b.allocated_amount : budgetProgress(b,transactions).remaining})).filter(i=>i.amount>0);
}
/** Suggestion from three completed months; the user confirms their own monthly base. */
export function essentialExpenseSuggestion(transactions: readonly Transaction[], categories: readonly string[], today=planningDateISO()) {
  const end=previousPlanningMonth(today);
  const start=previousPlanningMonth(previousPlanningMonth(end));
  const current=`${today.slice(0,7)}-01`;
  const rows=transactions.filter(t => isCashflow(t) && t.type === 'expense' && t.date >= start && t.date < current && categories.some(c=>c === t.categoryId || (c === 'food' && t.categoryId.startsWith('food-'))));
  return {monthly:fromMinorUnits(Math.ceil(toMinorUnits(sumMoney(rows.map(t=>t.amount)))/3)),start,end,hasHistory:rows.length>0};
}
