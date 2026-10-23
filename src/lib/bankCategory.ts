import type { TransactionType } from '../types.ts';
import { additionalCategorySuggestion } from './categories.ts';

export function detectBankCategory(text: string, type: TransactionType, cleanedMerchant?: string): string {
    const raw = (text + ' ' + (cleanedMerchant || '')).toLowerCase();
    // Explicit movements between own accounts keep their existing classification.
    if (raw.includes('перевод между счетами')) return 'transfer';

    const additional = additionalCategorySuggestion(raw, type);
    if (additional) return additional;

    // ── 2. Доходы (строгая и точная проверка) ──
    if (type === 'income') {
      // Зарплата только если явно указана
      if (raw.includes('зарплата') || raw.includes('зачисление заработной платы') || raw.includes('аванс') || raw.includes('salary') || raw.includes('оплата труда')) {
        return 'salary';
      }
      // Кэшбэк и бонусы
      if (raw.includes('альфа-бонус') || raw.includes('бонус') || raw.includes('кэшбэк') || raw.includes('cashback') || raw.includes('манибэк')) {
        return 'income-cashback';
      }
      // Внесение наличных через банкомат / инфокиоск
      if (raw.includes('банкомат') || raw.includes('внесение наличных') || raw.includes('recatm') || raw.includes('пополнение картсчетов') || raw.includes('инфокиоск')) {
        return 'income-other';
      }
      // Перевод от других людей / ЕРИП
      if (raw.includes('приорбанк') || raw.includes('беларусбанк') || raw.includes('технобанк') || raw.includes('перевод') || raw.includes('vyplaty') || raw.includes('выплаты')) {
        return 'income-transfer';
      }
      return 'income-other';
    }

    // ── 1. Продуктовые магазины (конкретные категории) ──
    if (raw.includes('gippo') || raw.includes('гиппо') || raw.includes('hippo') || raw.includes('belvillesden') || raw.includes('белвиллесден')) {
      return 'food-hippo';
    }
    if (raw.includes('euroopt') || raw.includes('евроопт') || raw.includes('edostavka') || raw.includes('е-доставка') || raw.includes('e-mall') || raw.includes('гипермолл')) {
      return 'food-euroopt';
    }
    if (raw.includes('green') || raw.includes('грин')) {
      return 'food-green';
    }
    if (raw.includes('sosedi') || raw.includes('соседи')) {
      return 'food-sosedi';
    }
    if (raw.includes('santa') || raw.includes('санта') || raw.includes('ритейлмаркет')) {
      return 'food-santa';
    }
    if (raw.includes('fix price') || raw.includes('fixprice') || raw.includes('фикс прайс')) {
      return 'food-fixprice';
    }
    if (raw.includes('groshyk') || raw.includes('грошык') || raw.includes('грошик')) {
      return 'food-groshyk';
    }
    if (raw.includes('mayak') || raw.includes('маяк')) {
      return 'food-mayak';
    }
    // Другие продуктовые магазины
    if (
      raw.includes('prostore') || raw.includes('простор') ||
      raw.includes('korona') || raw.includes('корона') ||
      raw.includes('universam') || raw.includes('универсам') ||
      raw.includes('zorina') || raw.includes('зорина') ||
      raw.includes('vitalur') || raw.includes('виталюр') ||
      raw.includes('belmarket') || raw.includes('белмаркет') ||
      raw.includes('мясной') || raw.includes('хлеб') || raw.includes('продукты') || raw.includes('гастроном') ||
      raw.includes('pekarnya') || raw.includes('пекарня') || raw.includes('terri')
    ) {
      return 'food';
    }

    // ── 3. Расходы ──
    // Фастфуд, кафе и рестораны
    if (
      raw.includes('kfc') || raw.includes('burger king') || raw.includes('burger-king') || raw.includes('mak.by') || raw.includes('макдональдс') ||
      raw.includes('dodo') || raw.includes('додо') || raw.includes('пицца') || raw.includes('pizza') || raw.includes('picca lisicca') || raw.includes('лисица') ||
      raw.includes('cofix') || raw.includes('кофикс') || raw.includes('coffee embassy') || raw.includes('kofesaund') || raw.includes('кофейня') || raw.includes('кофе') || raw.includes('coffee') ||
      raw.includes('padthai') || raw.includes('john doner') || raw.includes('шаурма') || raw.includes('донер') ||
      raw.includes('foodpicasso') || raw.includes('кафе') || raw.includes('cafe') || raw.includes('ресторан') || raw.includes('суши') || raw.includes('sushi') || raw.includes('бар') || raw.includes('delivio') || raw.includes('яндекс еда') || raw.includes('yandex.eda')
    ) {
      return 'cafes';
    }

    // Маркетплейсы
    if (raw.includes('wildberries') || raw.includes('wb') || raw.includes('вайлдберриз') || raw.includes('ozon') || raw.includes('озон') || raw.includes('izi shop') || raw.includes('izishop') || raw.includes('lamoda') || raw.includes('ламода') || raw.includes('oz.by')) {
      return 'marketplaces';
    }

    // Одежда и обувь
    if (raw.includes('zarina') || raw.includes('зарина') || raw.includes('galereya') || raw.includes('galleria') || raw.includes('галерея') || raw.includes('zara') || raw.includes('mark formelle') || raw.includes('марк формель') || raw.includes('kari') || raw.includes('карри') || raw.includes('дефакто') || raw.includes('defacto') || raw.includes('одежда') || raw.includes('обувь') || raw.includes('conte') || raw.includes('мегатоп')) {
      return 'clothes';
    }

    // Косметика и уход
    if (raw.includes('mila') || raw.includes('мила') || raw.includes('zolotoe yabloko') || raw.includes('золотое яблоко') || raw.includes('byuti level') || raw.includes('beauty level') || raw.includes('парфюм') || raw.includes('косметика') || raw.includes('салон красоты') || raw.includes('барбершоп')) {
      return 'beauty';
    }

    // Товары для дома
    if (raw.includes('galamart') || raw.includes('галамарт') || raw.includes('остров чистоты') || raw.includes('ostrov chistoty') || raw.includes('jysk') || raw.includes('юск') || raw.includes('ikea') || raw.includes('икеа') || raw.includes('ами мебель') || raw.includes('материк') || raw.includes('mile') || raw.includes('ома') || raw.includes('oma') || raw.includes('стройматериалы')) {
      return 'household';
    }

    // Такси и транспорт
    if (raw.includes('paybycard') || raw.includes('metro') || raw.includes('метро') || raw.includes('yubileyn') || raw.includes('aerodro') || raw.includes('wb taxi') || raw.includes('yandex go') || raw.includes('яндекс go') || raw.includes('яндекс такси') || raw.includes('yandex.taxi') || raw.includes('такси') || raw.includes('uber') || raw.includes('minsktrans') || raw.includes('минсктранс') || raw.includes('бжд') || raw.includes('rw.by') || raw.includes('проезд')) {
      return 'transport';
    }

    // Самокаты
    if (raw.includes('whoosh') || raw.includes('вуш') || raw.includes('eleven') || raw.includes('илевен') || raw.includes('kolobike') || raw.includes('busyfly') || raw.includes('jet') || raw.includes('кикшеринг')) {
      return 'scooters';
    }

    // Аптека и медицина
    if (raw.includes('sumbest') || raw.includes('apteka') || raw.includes('аптека') || raw.includes('планета здоровья') || raw.includes('фармация') || raw.includes('инвитро') || raw.includes('invitro') || raw.includes('синэво') || raw.includes('synevo') || raw.includes('лодэ') || raw.includes('нордин') || raw.includes('клиника') || raw.includes('стоматология') || raw.includes('медицинский')) {
      return 'medical';
    }

    // Связь, интернет, подписки
    if (raw.includes('beltelecom') || raw.includes('белтелеком') || raw.includes('byfly') || raw.includes('zala') || raw.includes('yandex plus') || raw.includes('яндекс плюс') || raw.includes('spotify') || raw.includes('apple.com') || raw.includes('itunes') || raw.includes('google play') || raw.includes('youtube') || raw.includes('telegram') || raw.includes('netflix') || raw.includes('кинопоиск')) {
      return 'internet';
    }
    if (raw.includes('a1') || raw.includes('а1') || raw.includes('мтс') || raw.includes('mts') || raw.includes('life')) {
      return 'mobile';
    }

    // ЕРИП и коммуналка
    if (raw.includes('insync (erip)') || raw.includes('ерип') || raw.includes('erip') || raw.includes('расчет') || raw.includes('жкх') || raw.includes('коммунал') || raw.includes('водоканал') || raw.includes('электроэнерг') || raw.includes('минскэнерго') || raw.includes('газоснабж') || /(?:^|[^\p{L}\p{N}])газ(?:$|[^\p{L}\p{N}])/u.test(raw)) {
      return 'utilities';
    }

    // Кредит
    if (raw.includes('погашения кредита') || raw.includes('погашение кредита') || raw.includes('кредит')) {
      return 'credit';
    }

    // Снятие наличных
    if (raw.includes('получение денег в банкомате') || (raw.includes('recatm') && type === 'expense') || (raw.includes('atm') && type === 'expense')) {
      return 'cash';
    }

    // Переводы
    if (raw.includes('перевод между счетами') || raw.includes('перевод')) {
      return 'transfer';
    }

    // Развлечения и ставки
    if (raw.includes('winline') || raw.includes('fonbet') || raw.includes('bezkassira') || raw.includes('кинотеатр') || raw.includes('cinema') || raw.includes('silver screen') || raw.includes('mooon') || raw.includes('боулинг') || raw.includes('билет')) {
      return 'entertainment';
    }

    // АЗС и авто
    if (raw.includes('belorusneft') || raw.includes('белоруснефть') || raw.includes('лукойл') || raw.includes('lukoil') || raw.includes('газпромнефть') || raw.includes('азс') || raw.includes('а-100') || raw.includes('заправка') || raw.includes('бензин')) {
      return 'car';
    }

    return 'other';
  }
