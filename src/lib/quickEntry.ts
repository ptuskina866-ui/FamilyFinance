import type { Account, Category, TransactionType } from '../types';
import { fromMinorUnits, localDateISO, parseMoneyInput, toMinorUnits } from './money';
import { isIncomeCategory } from './categories';

export interface QuickEntryDraft {
  kind: 'cashflow' | 'transfer'; type: TransactionType; amount: number | null;
  date: string; categoryId: string; accountId: string; targetAccountId: string;
  comment: string; issues: string[];
}
const normalize = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е');
const words: Record<string, number> = {
  ноль:0, один:1, одна:1, одну:1, два:2, две:2, три:3, четыре:4, пять:5, шесть:6, семь:7, восемь:8, девять:9,
  десять:10, одиннадцать:11, двенадцать:12, тринадцать:13, четырнадцать:14, пятнадцать:15, шестнадцать:16,
  семнадцать:17, восемнадцать:18, девятнадцать:19, двадцать:20, тридцать:30, сорок:40, пятьдесят:50,
  шестьдесят:60, семьдесят:70, восемьдесят:80, девяносто:90, сто:100, двести:200, триста:300,
  четыреста:400, пятьсот:500, шестьсот:600, семьсот:700, восемьсот:800, девятьсот:900,
};
const scales: Record<string, number> = {тысяча:1000, тысячи:1000, тысяч:1000, тысячу:1000, миллион:1000000, миллиона:1000000, миллионов:1000000};
const has=(dictionary:Record<string,number>,key:string)=>Object.prototype.hasOwnProperty.call(dictionary,key);
function integer(tokens: string[]): number | null {
  if (tokens.length === 1 && /^\d+$/.test(tokens[0])) return Number.isSafeInteger(Number(tokens[0])) ? Number(tokens[0]) : null;
  let total=0, part=0, last=1000, lastScale=Infinity;
  for (const token of tokens) {
    if (has(scales,token)) {
      const scale=scales[token]; if(scale>=lastScale)return null;
      total+=(part||1)*scale; part=0;last=1000;lastScale=scale;
    } else {
      const value=words[token]; if(value==null||value>=last||last<20)return null;
      part+=value;last=value>=100?100:value>=20?20:0;
    }
  }
  return tokens.length ? total+part : null;
}
function amountFrom(tokens: string[]): number | null {
  const rub=tokens.findIndex(t=>/^(рубль|рубля|рублей|руб|р|byn|br)$/.test(t));
  const kop=tokens.findIndex(t=>/^(копейка|копейки|копеек|коп)$/.test(t));
  const at = (ts:string[]) => parseMoneyInput(ts.join(' ')) ?? integer(ts);
  let major:number|null=null,minor=0;
  if(rub>=0) {
    major=at(tokens.slice(0,rub));
    const tail=tokens.slice(rub+1,kop<0?undefined:kop);
    if(tail.length) {const n=integer(tail);if(n==null||n>99)return null;minor=n;}
    if(kop>=0&&kop!==tokens.length-1)return null;
  } else if(kop>=0) {
    if(kop!==tokens.length-1)return null;
    const n=integer(tokens.slice(0,kop));return n!=null&&n>0&&n<=99?fromMinorUnits(n):null;
  } else {
    major=at(tokens);
    // Spoken prices: «пять пятьдесят». Never join two separate digit amounts.
    if(major==null&&tokens.length===2&&tokens.every(t=>has(words,t))) {
      const a=words[tokens[0]],b=words[tokens[1]];if(a<10&&b>=20&&b<100){major=a;minor=b;}
    }
  }
  if(major==null||major<0||(minor>0&&!Number.isInteger(major)))return null;
  try {const cents=toMinorUnits(major)+minor;return cents>0?fromMinorUnits(cents):null;}catch{return null;}
}
const categoryWords: Record<string,string[]> = {
  cafes:['кофе','кафе','ресторан','обед','завтрак','ужин','макбай'], beauty:['стрижка','стрижку','парикмахер','маникюр','салон'],
  food:['продукты','продуктов','хлеб','молоко'], transport:['такси','метро','автобус','проезд'],
  'income-freelance':['подработку','подработка','фриланс'], salary:['зарплату','зарплата','аванс'],
  'income-gift':['подарили','подарок'], fuel:['бензин','заправка'], health:['аптека','лекарства'],
};
function contains(text:string,term:string):boolean {
  return (` ${text.replace(/[^\p{L}\p{N}]+/gu,' ')} `).includes(` ${normalize(term).replace(/[^\p{L}\p{N}]+/gu,' ')} `);
}

/** Conservative, local parser. A draft never writes money or guesses an ambiguous amount. */
export function parseQuickEntry(input:string,accounts:readonly Account[],categories:readonly Category[],today=localDateISO()):QuickEntryDraft {
  let text=normalize(input.trim());
  const draft:QuickEntryDraft={kind:'cashflow',type:'expense',amount:null,date:today,categoryId:'',accountId:'',targetAccountId:'',comment:input.trim(),issues:[]};
  if(!text||text.length>400){draft.issues.push('Введите одну операцию, до 400 символов.');return draft;}
  if(/(?:^|\s)минус(?:\s|$)/.test(text)){draft.issues.push('Назовите положительную сумму и выберите расход или доход.');return draft;}
  if(/долг|одолж|взаймы/.test(text)){draft.issues.push('Учёт долгов пока не поддерживается. Эту фразу не сохраняем.');return draft;}
  if(/полтор|половин|четверт|около|примерно|почти/.test(text)){draft.issues.push('Укажите точную сумму, например «5,50» или «пять рублей пятьдесят копеек».');return draft;}
  if(/(?<!\p{L})(?:доллар[а-я]*|евро|usd|eur|российск[а-я]*|rub)(?!\p{L})|₽|\$|€/u.test(text)){draft.issues.push('Укажите сумму в BYN. Валютные операции добавим отдельно.');return draft;}
  const dates=[...text.matchAll(/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}|(?<!\p{L})(?:позавчера|вчера|сегодня)(?!\p{L})/gu)];
  if(dates.length>1){draft.issues.push('Укажите одну дату.');return draft;}
  if(dates.length) {
    const value=dates[0][0];let day=today;
    if(['сегодня','вчера','позавчера'].includes(value)){const d=new Date(today+'T12:00:00');d.setDate(d.getDate()-(value==='вчера'?1:value==='позавчера'?2:0));day=localDateISO(d);}
    else day=value.includes('.')?value.split('.').reverse().map((v,i)=>i? v.padStart(2,'0'):v).join('-'):value;
    const d=new Date(day+'T12:00:00');
    if(!Number.isFinite(d.getTime())||localDateISO(d)!==day){draft.issues.push('Проверьте дату операции.');return draft;}
    draft.date=day;text=text.replace(value,' ');
  }
  if(/завтра|прошл|позапрошл|недел|месяц|январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр/.test(text)){
    draft.issues.push('Для даты используйте «вчера» или ДД.ММ.ГГГГ.');return draft;
  }
  const active=accounts.filter(a=>!a.is_archived);
  const named=active.filter(a=>a.name.length>2&&contains(text,a.name));
  for(const a of named)text=text.replace(normalize(a.name),' '); // Account names may contain digits.
  const withdrawal=/(?:^|\s)(?:снял|сняла|сняли|снять)(?:\s|$)/.test(text);
  const deposit=/внес[л]?|внесла|положил|положила|пополнил|пополнила/.test(text)&&/налич/.test(text)&&/карт|счет/.test(text);
  draft.kind=withdrawal||deposit||/(?<!\p{L})(?:перевел|перевела)(?!\p{L})|перевод между/u.test(text)?'transfer':'cashflow';
  if(draft.kind==='transfer'){
    const fromKind=withdrawal?'bank':deposit?'cash':null,toKind=withdrawal?'cash':deposit?'bank':null;
    const candidates=(kind:string|null)=>{const matches=named.filter(a=>a.kind===kind);return matches.length?matches:active.filter(a=>kind?a.kind===kind:named.some(n=>n.id===a.id));};
    const from=candidates(fromKind),to=candidates(toKind);
    if(from.length===1)draft.accountId=from[0].id;
    if(to.length===1)draft.targetAccountId=to[0].id;
    // Generic transfers need explicit direction in the review form.
    if(!fromKind){draft.accountId='';draft.targetAccountId='';}
  }else{
    draft.type=/(?:^|\s)(?:получил|получила|пришли|пришла|заработал|заработала|подарили|перевели|доход)(?:\s|$)/.test(text)?'income':'expense';
    const kind=/налич/.test(text)?'cash':/карт|приор/.test(text)?'bank':'cash';
    const choices=named.length?named:active.filter(a=>a.kind===kind);
    if(choices.length===1)draft.accountId=choices[0].id;
    const matching=categories.filter(c=>isIncomeCategory(c.id)===(draft.type==='income')&&
      [c.name,...(categoryWords[c.id]||[]),...(c.searchTerms||[]).filter(t=>t.length>2&&!/\d/.test(t)&&!has(words,t))].some(t=>contains(text,t)));
    if(matching.length===1)draft.categoryId=matching[0].id;
  }
  const tokens=text.match(/-?\d+(?:[.,]\d+)?|[\p{L}]+/gu)||[];
  const numberToken=(t:string)=>/^[-\d]/.test(t)||has(words,t)||has(scales,t);
  const moneyToken=(t:string)=>/^(рубль|рубля|рублей|руб|р|byn|br|копейка|копейки|копеек|коп)$/.test(t);
  const runs:string[][]=[];
  for(let i=0;i<tokens.length;i++)if(numberToken(tokens[i])) {
    const run=[tokens[i]];while(i+1<tokens.length&&(numberToken(tokens[i+1])||moneyToken(tokens[i+1])))run.push(tokens[++i]);runs.push(run);
  }
  if(runs.length===1)draft.amount=amountFrom(runs[0]);
  if(draft.amount==null)draft.issues.push('Не удалось однозначно определить сумму. Оставьте в фразе одну сумму.');
  return draft;
}
