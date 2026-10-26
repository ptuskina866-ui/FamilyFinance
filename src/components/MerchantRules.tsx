import { useState } from 'react';
import { ChevronDown,Trash2 } from 'lucide-react';
import { useApp } from '../AppContext';

export function MerchantRules(){
 const {merchantRules=[],smartRulesReady,deleteMerchantRule,categories}=useApp();
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 if(!smartRulesReady)return null;
 const remove=async(id:string)=>{if(busy)return;setBusy(id);setError('');try{await deleteMerchantRule(id);}catch{setError('Не удалось удалить правило. Повторите попытку.');}finally{setBusy(null);}};
 return <details className="card disclosure p-4"><summary>Правила магазинов · {merchantRules.length}<ChevronDown size={15}/></summary><div className="disclosure-body space-y-3">
  <p className="bank-caption">Создаются при редактировании банковской операции с выбором «Всегда относить…». Действуют для следующих операций всей семьи.</p>
  {error&&<p role="alert" className="bank-caption text-rose-700">{error}</p>}
  {merchantRules.map(rule=><div key={rule.id} className="flex items-center gap-3 border-b border-slate-100 pb-3"><div className="flex-1 min-w-0"><p className="text-xs font-semibold break-words">{rule.display_name}</p><p className="bank-caption">{rule.transaction_type==='income'?'Доход':'Расход'} · {categories.find(c=>c.id===rule.category_id)?.name||rule.category_id}</p></div><button type="button" className="icon-button shrink-0" aria-label={'Удалить правило '+rule.display_name} disabled={!!busy} onClick={()=>void remove(rule.id)}><Trash2 size={15}/></button></div>)}
  <p className="bank-caption">Удаление правила сохраняет уже учтённые категории. Чтобы изменить правило, исправьте следующую операцию и снова выберите «Всегда относить…».</p>
 </div></details>;
}
