import type { MerchantRule, Transaction } from '../types';

// Literal brand patterns are mirrored in the database; unknown branches/numbers stay distinct.
export const MERCHANTS = [
 ['mak-by','Мак.by','mak[.]by|мак[.]by'], ['netflix','Netflix','netflix'],
 ['spotify','Spotify','spotify'], ['apple','Apple','apple[.]com/bill|apple[.]com'],
 ['yandex-plus','Яндекс Плюс','yandex[ .]*plus|яндекс[ .]*плюс'],
 ['euroopt','Евроопт','euroopt|евроопт|edostavka|е-доставка'],
 ['green','Green','green|грин'], ['santa','Санта','santa|санта'],
 ['sosedi','Соседи','sosedi|соседи'], ['hippo','Гиппо','gippo|hippo|гиппо'],
 ['wildberries','Wildberries','wildberries|вайлдберриз'], ['ozon','Ozon','ozon|озон'],
 ['a1','А1','a1|velcom'], ['mts','МТС','mts|мтс'], ['byfly','Byfly','byfly'],
] as const;

export function merchantIdentity(description:string):{key:string;name:string} {
 const normalized=description.normalize('NFKC').toLocaleLowerCase('ru-RU');
 for(const [id,name,pattern] of MERCHANTS) if(new RegExp(`(^|[^\\p{L}\\p{N}])(${pattern})($|[^\\p{L}\\p{N}])`,'u').test(normalized))return {key:'brand:'+id,name};
 const key=normalized.replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 if(key.length<2||key.length>240||! /\p{L}/u.test(key)||/^(покупка|оплата|платеж|платёж|расход|продукты|еда|кафе|такси|перевод|другое|импорт выписки|без комментария)$/u.test(key))return {key:'',name:description.trim()};
 return {key:'raw:'+key,name:description.trim()};
}
export const transactionMerchant=(tx:Transaction)=>tx.bankEvent?.merchant_key?{key:tx.bankEvent.merchant_key,name:tx.bankEvent.merchant_name||tx.bankEvent.description}:merchantIdentity(tx.bankEvent?.description||tx.comment);
export function transactionTitle(tx:Transaction,rules:readonly MerchantRule[]=[]):string {
 if(!tx.bankEvent)return tx.comment;
 const identity=transactionMerchant(tx),rule=rules.find(r=>r.merchant_key===identity.key&&r.transaction_type===tx.type);
 // A personal note stays visible; the bank descriptor is always retained separately.
 if(tx.comment&&tx.comment!==tx.bankEvent.description)return tx.comment;
 return rule?.display_name||identity.name||tx.comment;
}
