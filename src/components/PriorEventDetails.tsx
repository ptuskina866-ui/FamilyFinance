import type { PriorBankEvent } from '../types';
import { toMinorUnits, fromMinorUnits } from '../lib/money';

const money=(value:string|number)=>fromMinorUnits(toMinorUnits(value)).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' BYN';
export function PriorEventDetails({event,hidden}:{event:PriorBankEvent;hidden:boolean}){
 const label=event.state==='provisional'?'Предварительно':event.state==='cancelled'?'Отменено · в расчётах 0':event.state==='needs_review'?(event.suppressed?'Сохранена ваша запись':'Нужна сверка · учтена прежняя сумма'):'Проведено банком';
 const changes=event.history.filter(item=>item.oldAmount!==item.amount||item.toState==='cancelled');
 return <div className="text-[11px] leading-relaxed mt-1">
  {(event.state!=='posted'||changes.length>0)&&<span className={event.state==='provisional'?'text-blue-700':event.state==='needs_review'?'text-amber-800':'text-slate-500'}>{label}</span>}
  <details className="text-slate-500"><summary className="cursor-pointer py-1">Данные банка</summary><p className="break-words">{event.description}</p></details>
  {changes.length>0&&<details className="mt-1 text-slate-500"><summary className="cursor-pointer">Изменено банком</summary><div className="space-y-1 mt-1">{changes.map((item,index)=><p key={index}>{new Date(item.at).toLocaleString('ru-RU')} · {hidden?'••••':`${money(item.oldAmount)} → ${item.toState==='cancelled'?'отмена':money(item.amount)}`}</p>)}</div></details>}
 </div>;
}
