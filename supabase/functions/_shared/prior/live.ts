import { createHash } from 'node:crypto';
import { toMinorUnits } from '../../../../src/lib/money.ts';
import { detectBankCategory } from '../../../../src/lib/bankCategory.ts';
import { type BankPreview, PreviewError } from './model.ts';

export interface PriorLiveRecord {
  key:string; matchKey:string; day:string; occurredAt:string; preciseTime:boolean;
  description:string; amount:string; originalAmount:string|null; originalCurrency:string;
  source:'history'|'additional'; state:'provisional'|'posted'|'needs_review';
  category:string; transfer:boolean; legacy:Record<string,unknown>;
}
export interface PriorLiveSnapshot {version:2;sourceKey:string;from:string;to:string;fetchedAt:string;records:PriorLiveRecord[];}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const signedText=(cents:number)=>`${cents<0?'-':''}${Math.trunc(Math.abs(cents)/100)}.${String(Math.abs(cents)%100).padStart(2,'0')}`;
/** Separate wire semantics: regular accountAmount; authorization account amount is -amount.
 * No guessed exchange rates, balances or cancellation inferred from disappearance. */
export function priorLiveSnapshot(preview:BankPreview,sourceKey:string):PriorLiveSnapshot {
  const card=preview.cards.find(c=>hash(['prior-card-v1',c.id,c.currency])===sourceKey);
  if(!card||card.currency!=='BYN')throw new PreviewError('FORMAT_CHANGED','Связанная карта BYN недоступна.');
  const occurrences=new Map<string,number>();
  const records=card.records.map(row=>{
    const day=row.date.slice(0,10),embedded=/T(\d{2}:\d{2}:\d{2})/.exec(row.date)?.[1];
    const time=row.transTime??embedded??'00:00:00',preciseTime=time!=='00:00:00';
    const occurredAt=day+'T'+time+'+03:00';
    const amount=row.source==='history'?row.accountAmount:signedText(-toMinorUnits(row.operationAmount));
    if(amount===null)throw new PreviewError('AMOUNT_INVALID','Нет суммы операции по счёту.');
    const originalAmount=row.source==='history'?row.operationAmount:row.purchaseAmount??(row.operationCurrency===card.currency?row.operationAmount:null);
    // A missing foreign purchase amount is displayed for review; it must not acquire a made-up rate.
    const state=toMinorUnits(amount)===0||(row.source==='additional'&&row.operationCurrency!==card.currency&&originalAmount===null)?'needs_review':row.source==='history'?'posted':'provisional';
    const normalized=row.description.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU');
    const matchKey=hash([sourceKey,occurredAt,normalized,toMinorUnits(amount)<0?'expense':'income',row.operationCurrency]);
    const fingerprint=hash([matchKey,amount,originalAmount,row.source]);
    const occurrence=(occurrences.get(fingerprint)??0)+1;occurrences.set(fingerprint,occurrence);
    return {key:fingerprint+':'+occurrence,matchKey,day,occurredAt,preciseTime,description:row.description,amount,
      originalAmount,originalCurrency:row.operationCurrency,source:row.source,state,
      category:detectBankCategory(row.description,toMinorUnits(amount)<0?'expense':'income'),
      transfer:/между\s+(?:своими\s+)?сч[её]т|собственн.{0,25}сч[её]т|own\s+account/i.test(row.description),
      legacy:{date:row.date,description:row.description,accountAmount:row.accountAmount,operationAmount:row.operationAmount,operationCurrency:row.operationCurrency,fee:row.fee,source:row.source}} satisfies PriorLiveRecord;
  });
  return {version:2,sourceKey,from:preview.from,to:preview.to,fetchedAt:preview.fetchedAt,records};
}
