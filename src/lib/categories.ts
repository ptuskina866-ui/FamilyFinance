import type { Category, ExpenseCategoryGroup, TransactionType } from '../types';

type Tone = ExpenseCategoryGroup | 'income';
const tones: Record<Tone, Pick<Category, 'color' | 'bgColor' | 'borderColor' | 'accentColor'>> = {
  food: {color:'text-emerald-700',bgColor:'bg-emerald-50',borderColor:'border-emerald-100',accentColor:'#47745d'},
  shopping: {color:'text-violet-700',bgColor:'bg-violet-50',borderColor:'border-violet-100',accentColor:'#8063a4'},
  transport: {color:'text-amber-800',bgColor:'bg-amber-50',borderColor:'border-amber-100',accentColor:'#987245'},
  bills: {color:'text-blue-800',bgColor:'bg-blue-50',borderColor:'border-blue-100',accentColor:'#526fa7'},
  life: {color:'text-rose-800',bgColor:'bg-rose-50',borderColor:'border-rose-100',accentColor:'#98677b'},
  income: {color:'text-emerald-700',bgColor:'bg-emerald-50',borderColor:'border-emerald-100',accentColor:'#39785e'},
};
const category = (id:string,name:string,icon:string,tone:Tone,searchTerms:string[],note?:string):Category => ({id,name,icon,...tones[tone],group:tone==='income'?undefined:tone,searchTerms,note});

// Additive IDs: saved transactions and existing budget scopes are never rewritten.
export const ADDITIONAL_CATEGORIES: Category[] = [
  category('food-korona','Корона','ShoppingCart','food',['korona','корона']),
  category('food-prostore','ProStore','ShoppingCart','food',['prostore','простор']),
  category('food-belmarket','Белмаркет','Store','food',['belmarket','белмаркет','бел маркет']),
  category('food-dobronom','Доброном','Store','food',['dobronom','дабраном']),
  category('food-kopeechka','Копеечка','Store','food',['kopeechka','капеечка']),
  category('vape-tobacco','Вейп и табак','Wind','shopping',['вейпшоп','вэйп','vape','vape shop','табачный','сигареты','электронные сигареты']),
  category('food-delivery','Доставка продуктов','Truck','food',['доставка продуктов','zakaz','доставка магазина'], 'Продуктовая доставка. Готовые блюда — в категории «Доставка еды».'),
  category('meal-delivery','Доставка еды','Bike','food',['delivio','деливио','яндекс еда','yandex eats','yandex.eda','доставка блюд']),
  category('fuel','Топливо и АЗС','Fuel','transport',['белоруснефть','belorusneft','а100','а-100','бензин','дизель','электрозарядка']),
  category('parking','Парковка','ParkingSquare','transport',['паркинг','parkouka','паркоўка','платная стоянка']),
  category('car-service','Сервис авто','Wrench','transport',['сто','шиномонтаж','автосервис','ремонт авто','техосмотр']),
  category('subscriptions','Подписки','Repeat','bills',['яндекс плюс','yandex plus','spotify','youtube','icloud','netflix','кинопоиск','подписка']),
  category('bank-fees','Комиссии банка','Landmark','bills',['комиссия','банковское обслуживание','комиссии','bank fee']),
  category('postal','Почта и посылки','Package','shopping',['европочта','евро почта','белпочта','europochta','belpochta','сдэк','cdek','посылка']),
  category('home-repair','Ремонт и стройка','Hammer','shopping',['ома','oma','материк','mile','стройматериалы','ремонт квартиры']),
  category('children','Дети','Baby','life',['детский сад','школа','кружки','подгузники','игрушки','питание ребенка']),
  category('sport','Спорт','Dumbbell','life',['фитнес','спортзал','бассейн','тренажерный зал','тренировки','абонемент']),
  category('travel','Путешествия','Plane','life',['отель','гостиница','авиабилеты','отпуск','туризм','booking']),
  category('digital','Игры и приложения','Gamepad2','life',['steam','playstation','xbox','игры','приложения','донаты']),
  category('charity','Благотворительность','HeartHandshake','life',['пожертвования','помощь фонду','благотворительный']),
  category('income-bonus','Премии и отпускные','Award','income',['премия','бонус от работодателя','отпускные']),
  category('income-business','Самозанятость / ИП','Briefcase','income',['самозанятость','ип','заказчик','выручка','оплата услуг','нпд']),
  category('income-sale','Продажа вещей','ShoppingBag','income',['куфар','kufar','продажа вещей','продажа техники']),
  category('income-rent','Сдача в аренду','KeyRound','income',['арендная плата','аренда квартиры','сдача квартиры','аренда имущества']),
  category('income-pension','Пенсия','Wallet','income',['пенсия','пенсионные']),
  category('income-benefits','Пособия и выплаты','HandHeart','income',['пособие','декретные','социальная выплата','алименты']),
  category('income-scholarship','Стипендия','GraduationCap','income',['стипендия','scholarship']),
  category('income-interest','Проценты по вкладам','Percent','income',['вклад','депозит','проценты по вкладу','проценты по депозиту']),
  category('income-dividends','Дивиденды','LineChart','income',['дивиденды','dividend']),
  category('income-refund','Возврат покупки','Undo2','income',['возврат','refund','возмещение покупки'], 'Будет учтён как поступление. Исходная покупка останется в расходах.'),
  category('income-gift','Денежные подарки','Gift','income',['подарок','день рождения','денежный подарок']),
];

const legacyGroups: Record<string,ExpenseCategoryGroup> = {
  food:'food',cafes:'food',marketplaces:'shopping',clothes:'shopping',household:'shopping',beauty:'shopping',electronics:'shopping',gifts:'shopping',
  transport:'transport',car:'transport',scooters:'transport',housing:'bills',utilities:'bills',water:'bills',mobile:'bills',internet:'bills',credit:'bills',taxes:'bills',
};
const legacySearch: Record<string,string[]> = {
  'food-hippo':['гиппо','gippo','hippo','белвиллесден'],
  'food-euroopt':['euroopt','едоставка','е-доставка','edostavka','е молл','emall','e mall','гипермолл'],
  'food-green':['грин','green'], 'food-groshyk':['грошык','groshyk'], 'food-fixprice':['фикс прайс','fix price'],
  marketplaces:['wildberries','вайлдберриз','вб','ozon','озон','oz.by','оз бай','куфар','kufar'],
  electronics:['21vek','21 век','онлайнер','onliner','5 элемент','5element','корона техно'],
  clothes:['марк формэль','mark formelle','conte','конте','мегатоп','megatop'],
  beauty:['мила','mila','золотое яблоко','косметика'],household:['остров чистоты','jysk','юск','мебель'],
  mobile:['мтс','mts','а1','a1','life'],internet:['белтелеком','beltelecom','byfly','zala'],
  transport:['минсктранс','метро','бжд','rw.by','такси','yandex go','яндекс go'],
  salary:['зарплата','аванс','оплата труда','salary'], 'income-transfer':['перевод от человека','поступление','p2p'],
  'income-cashback':['cashback','манибэк','moneyback','кешбэк','кэшбек'], 'income-freelance':['фриланс','freelance','подработка'],
};
export const isIncomeCategory = (id:string) => id==='salary'||id.startsWith('income-');
export const categoryGroup = (item:Category):ExpenseCategoryGroup => item.group ?? (item.id.startsWith('food-')?'food':legacyGroups[item.id] ?? 'life');
export const categoryTone = (item:Category):Tone => isIncomeCategory(item.id)?'income':categoryGroup(item);
export const normalizeCategoryQuery = (value:string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function matchesCategoryQuery(item:Category,query:string):boolean {
  const haystack=normalizeCategoryQuery([item.name,...(item.searchTerms??[]),...(legacySearch[item.id]??[])].join(' '));
  return normalizeCategoryQuery(query).split(' ').filter(Boolean).every(word=>haystack.includes(word));
}

// Suggestions apply to new bank previews only; users still review every chosen category.
export function additionalCategorySuggestion(text:string,type:TransactionType):string|null {
  const raw=normalizeCategoryQuery(text);
  const rules: [RegExp,string][] = type==='income' ? [
    [/возврат.*(покуп|оплат|товар)|refund|возмещение покупки/,'income-refund'],
    [/стипенд|scholarship/,'income-scholarship'],[/пенси/,'income-pension'],[/пособи|декретн|алименты|социальн.*выплат/,'income-benefits'],
    [/дивиденд|dividend/,'income-dividends'],[/процент.*(вклад|депозит)/,'income-interest'],[/арендная плата|оплата аренды|сдача.*аренду/,'income-rent'],
    [/преми|отпускны/,'income-bonus'],[/оплата услуг|выручка|доход.*самозанят/,'income-business'],
  ] : [
    [/\b(vape|vaping)\b|вейп|вэйп|табачн|электронн.*сигарет/,'vape-tobacco'],
    [/корона техно|\bkorona techno\b/,'electronics'],[/корона дом|\bkorona dom\b/,'household'],
    [/(?:^| )(?:korona|корона)(?= |$)(?! (?:техно|techno|дом|dom|pay))|коронамаркет/,'food-korona'],
    [/\bprostore\b|простор/,'food-prostore'],[/\bbelmarket\b|белмаркет/,'food-belmarket'],[/\bdobronom\b|доброном|дабраном/,'food-dobronom'],[/\bkopeechka\b|копеечка|капеечка/,'food-kopeechka'],
    [/европочт|белпочт|\b(europochta|belpochta|cdek)\b|сдэк/,'postal'],
    [/\b(delivio|yandex eda|yandex eats)\b|деливио|яндекс еда/,'meal-delivery'],
    [/яндекс плюс|\byandex plus\b|\b(spotify|netflix|icloud)\b|кинопоиск|подписка/,'subscriptions'],
    [/\bparkouka\b|платная парковка|оплата парковки/,'parking'],
  ];
  return rules.find(([pattern])=>pattern.test(raw))?.[1] ?? null;
}
