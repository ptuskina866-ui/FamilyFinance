import { Transaction, TransactionType } from '../types';

export interface AlfaTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  type: TransactionType;
  merchant: string;
  comment: string;
  categoryId: string;
  currency: string;
  isDuplicate?: boolean;
  raw?: string;
  accountNumber?: string;
}

export interface AlfaAccount {
  id: string;
  name: string;
  number: string;
  balance: number;
  currency: string;
  cardName: string;
  maskedCard: string;
}

export interface AlfaAuthState {
  step: 'credentials' | 'otp' | 'connected';
  phone?: string;
  maskedPhone?: string;
  sessionToken?: string;
  lastSynced?: string;
  account?: AlfaAccount;
}

// ── 1. Справочник авто-категоризации под магазины и сервисы Беларуси ──
const CATEGORY_RULES: { keywords: string[]; categoryId: string }[] = [
  // Продуктовые сети и супермаркеты
  { keywords: ['евроопт', 'euroopt', 'edostavka', 'е-доставка', 'гипермолл', 'e-mall'], categoryId: 'food-euroopt' },
  { keywords: ['green', 'грин', 'гриин'], categoryId: 'food-green' },
  { keywords: ['гиппо', 'hippo', 'belmarket', 'белмаркет'], categoryId: 'food-hippo' },
  { keywords: ['соседи', 'sosedi'], categoryId: 'food-sosedi' },
  { keywords: ['санта', 'santa', 'ритейлмаркет'], categoryId: 'food-santa' },
  { keywords: ['грошык', 'groshyk'], categoryId: 'food-groshyk' },
  { keywords: ['маяк', 'mayak'], categoryId: 'food-mayak' },
  { keywords: ['fixprice', 'fix price', 'фикс прайс'], categoryId: 'food-fixprice' },
  { keywords: ['корона', 'korona', 'продукты', 'универсам', 'гастроном', 'мясной', 'хлеб', 'vitalur', 'виталюр'], categoryId: 'food' },

  // Маркетплейсы
  { keywords: ['wildberries', 'wb', 'вайлдберриз', 'ozon', 'озон', 'lamoda', 'ламода', 'oz.by', 'oz by', 'яндекс маркет'], categoryId: 'marketplaces' },

  // Техника и электроника
  { keywords: ['21vek', '21 век', '5 элемент', '5element', 'электросила', 'sila.by', 'mvideo', 'i-store', 'istore', 'a1 shop', 'мтс салон'], categoryId: 'electronics' },

  // Авто и АЗС
  { keywords: ['белоруснефть', 'belorusneft', 'лукойл', 'lukoil', 'газпромнефть', 'gazpromneft', 'а-100', 'a-100', 'united company', 'azs', 'азс', 'автомойка', 'шиномонтаж', 'автозапчасти', 'armtek', 'шате-м'], categoryId: 'car' },

  // Такси и общественный транспорт
  { keywords: ['yandex go', 'яндекс go', 'яндекс такси', 'yandex.taxi', 'такси', 'uber', 'minsktrans', 'минсктранс', 'метро', 'бжд', 'rw.by', 'пассажирские перевозки'], categoryId: 'transport' },

  // Самокаты и кикшеринг
  { keywords: ['whoosh', 'вуш', 'kolobike', 'колобайк', 'busyfly', 'jet', 'samokat', 'кикшеринг'], categoryId: 'scooters' },

  // Мобильная связь
  { keywords: ['a1', 'а1', 'мтс', 'mts', 'life:)', 'life', 'лайф'], categoryId: 'mobile' },

  // Интернет и ТВ
  { keywords: ['белтелеком', 'beltelecom', 'byfly', 'zala', 'космос тв', 'cosmostv', 'a1 интернет', 'unet'], categoryId: 'internet' },

  // Коммуналка и ЕРИП
  { keywords: ['ерип', 'erip', 'расчет', 'жкх', 'коммунал', 'водоканал', 'минскводоканал', 'электроэнерг', 'минскэнерго', 'газ'], categoryId: 'utilities' },

  // Медицина и аптеки
  { keywords: ['аптека', 'apteka', 'планета здоровья', 'фармация', 'инвитро', 'invitro', 'синэво', 'synevo', 'лодэ', 'lode', 'нордин', 'клиника', 'стоматология', 'медицинский центр', 'doctor'], categoryId: 'medical' },

  // Кафе и рестораны
  { keywords: ['кафе', 'cafe', 'ресторан', 'кофе', 'coffee', 'васильки', 'vasilki', 'макдональдс', 'mak.by', 'kfc', 'burger king', 'додо', 'dodo', 'пицца', 'pizza', 'хинкальная', 'суши', 'sushi', 'бар', 'bar', 'паб', 'bakery', 'пекарня'], categoryId: 'cafes' },

  // Одежда и обувь
  { keywords: ['zara', 'mark formelle', 'марк формель', 'карри', 'kari', 'дефакто', 'defacto', 'bershka', 'pull&bear', 'stradivarius', 'mango', 'одежда', 'обувь', 'conte', 'конте', 'мегатоп', 'megatop'], categoryId: 'clothes' },

  // Товары для дома
  { keywords: ['jysk', 'юск', 'ikea', 'икеа', 'ами мебель', 'материк', 'новоселкин', 'mile', 'стройматериалы', 'ома', 'oma'], categoryId: 'household' },

  // Питомцы
  { keywords: ['зоомаркет', 'zoomarket', 'зообазар', 'zoobazar', 'ветклиника', 'зоотовары', 'кот и пес'], categoryId: 'pets' },

  // Развлечения и отдых
  { keywords: ['кинотеатр', 'cinema', 'silver screen', 'mooon', 'боулинг', 'аквапарк', 'билет', 'kvitki', 'ticketpro', 'парк', 'музей', 'театр'], categoryId: 'entertainment' },

  // Доходы
  { keywords: ['зарплата', 'зачисление заработной платы', 'аванс', 'salary', 'оплата труда', 'пособие'], categoryId: 'salary' },
  { keywords: ['кэшбэк', 'cashback', 'манибэк', 'манибэк альфа', 'бонус', 'проценты на остаток'], categoryId: 'income-other' }
];

export class AlfaBankService {
  /**
   * Определение категории по тексту назначения платежа / названию торговой точки
   */
  static detectCategory(text: string, type: TransactionType): string {
    const lower = text.toLowerCase();

    for (const rule of CATEGORY_RULES) {
      if (rule.keywords.some(kw => lower.includes(kw))) {
        return rule.categoryId;
      }
    }

    if (type === 'income') {
      return 'income-other';
    }
    return 'food'; // По умолчанию для большинства обычных трат
  }

  /**
   * Проверка на дубликаты среди уже существующих транзакций
   */
  static markDuplicates(
    parsedList: AlfaTransaction[],
    existing: Transaction[]
  ): AlfaTransaction[] {
    return parsedList.map(tx => {
      const isDup = existing.some(ext => {
        // Проверяем тип и точную сумму
        if (ext.type !== tx.type) return false;
        if (Math.abs(ext.amount - tx.amount) > 0.01) return false;

        // Проверяем дату (допускаем расхождение в 1 день из-за клиринга банка)
        const tDate = new Date(tx.date).getTime();
        const eDate = new Date(ext.date).getTime();
        const daysDiff = Math.abs(tDate - eDate) / (1000 * 60 * 60 * 24);

        if (daysDiff > 1.5) return false;

        // Если комментарий или категория очень похожи
        const normTx = (tx.merchant + ' ' + tx.comment).toLowerCase();
        const normExt = ext.comment.toLowerCase();
        
        return normTx.includes(normExt) || normExt.includes(tx.merchant.toLowerCase()) || daysDiff === 0;
      });

      return {
        ...tx,
        isDuplicate: isDup
      };
    });
  }

  /**
   * Парсинг файла выписки Альфа-Банка (CSV / TXT / 1C)
   */
  static parseStatementFile(fileContent: string): AlfaTransaction[] {
    const lines = fileContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const results: AlfaTransaction[] = [];

    // Проверяем формат 1C (1CClientBankExchange)
    if (fileContent.includes('1CClientBankExchange') || fileContent.includes('СекцияДокумент')) {
      return this.parse1CFormat(lines);
    }

    // Проверяем CSV / Табличный формат (InSync export / Web Click CSV)
    let isHeaderSkipped = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Пропускаем заголовки
      if (!isHeaderSkipped) {
        if (line.toLowerCase().includes('дата') || line.toLowerCase().includes('date') || line.toLowerCase().includes('сумма')) {
          isHeaderSkipped = true;
          continue;
        }
      }

      // Разделение по точке с запятой, табуляции или запятой
      const cols = line.includes(';') ? line.split(';') : line.includes('\t') ? line.split('\t') : line.split(',');
      if (cols.length < 3) continue;

      const cleanedCols = cols.map(c => c.replace(/^["']|["']$/g, '').trim());

      // Пытаемся найти дату
      let dateStr = '';
      let amount = 0;
      let merchant = '';
      let comment = '';
      let type: TransactionType = 'expense';

      for (const col of cleanedCols) {
        // Поиск даты формата DD.MM.YYYY или YYYY-MM-DD
        const dateMatch = col.match(/^(\d{2})\.(\d{2})\.(\d{4})/) || col.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch && !dateStr) {
          if (dateMatch[3] && dateMatch[3].length === 4) {
            dateStr = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
          } else {
            dateStr = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
          }
          continue;
        }

        // Поиск суммы (например: -15.40, 15,40 BYN, +250.00)
        const amountMatch = col.match(/([+-]?\s*\d+[\.,]\d{2})/);
        if (amountMatch && amount === 0) {
          const rawNum = amountMatch[1].replace(/\s+/g, '').replace(',', '.');
          const val = parseFloat(rawNum);
          if (!isNaN(val)) {
            if (val > 0 && (col.includes('+') || line.toLowerCase().includes('зачисление') || line.toLowerCase().includes('пополнение'))) {
              type = 'income';
              amount = Math.abs(val);
            } else {
              type = val < 0 ? 'expense' : (col.includes('-') ? 'expense' : 'expense');
              amount = Math.abs(val);
            }
          }
          continue;
        }

        // Описание / Мерчант
        if (col.length > 3 && !col.match(/^\d+$/) && !merchant) {
          merchant = col;
        } else if (col.length > 3 && !comment) {
          comment = col;
        }
      }

      if (dateStr && amount > 0) {
        const fullDesc = [merchant, comment].filter(Boolean).join(' - ');
        results.push({
          id: `alfa-file-${Date.now()}-${results.length}-${Math.random().toString(36).substr(2, 4)}`,
          date: dateStr,
          amount,
          type,
          merchant: merchant || 'Альфа-Банк покупка',
          comment: fullDesc || 'Операция по карте',
          categoryId: this.detectCategory(fullDesc, type),
          currency: 'BYN',
          raw: line
        });
      }
    }

    return results;
  }

  /**
   * Парсинг формата выписки 1С (стандарт для большинства банков РБ)
   */
  private static parse1CFormat(lines: string[]): AlfaTransaction[] {
    const results: AlfaTransaction[] = [];
    let currentDoc: Record<string, string> | null = null;

    for (const line of lines) {
      if (line.startsWith('СекцияДокумент')) {
        currentDoc = {};
      } else if (line.startsWith('КонецДокумента') && currentDoc) {
        const dateRaw = currentDoc['Дата'] || currentDoc['ДатаСписано'] || currentDoc['ДатаПоступило'];
        const amountRaw = currentDoc['Сумма'];
        const purpose = currentDoc['НазначениеПлатежа'] || currentDoc['Плательщик'] || currentDoc['Получатель'] || '';

        if (dateRaw && amountRaw) {
          // Дата DD.MM.YYYY -> YYYY-MM-DD
          const parts = dateRaw.split('.');
          const isoDate = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : new Date().toISOString().split('T')[0];
          const amount = Math.abs(parseFloat(amountRaw.replace(',', '.')));
          const isIncome = !!currentDoc['ДатаПоступило'] && !currentDoc['ДатаСписано'];
          const type: TransactionType = isIncome ? 'income' : 'expense';

          results.push({
            id: `alfa-1c-${Date.now()}-${results.length}`,
            date: isoDate,
            amount,
            type,
            merchant: currentDoc['Получатель'] || currentDoc['Плательщик'] || 'Операция',
            comment: purpose,
            categoryId: this.detectCategory(purpose, type),
            currency: 'BYN'
          });
        }
        currentDoc = null;
      } else if (currentDoc) {
        const eqIdx = line.indexOf('=');
        if (eqIdx !== -1) {
          const key = line.slice(0, eqIdx).trim();
          const val = line.slice(eqIdx + 1).trim();
          currentDoc[key] = val;
        }
      }
    }

    return results;
  }

  /**
   * Мок/Демо коннектор веб-банка (для тестирования авторизации и получения счетов/выписки)
   */
  static async requestLogin(phone: string): Promise<{ success: boolean; maskedPhone: string; error?: string }> {
    // Имитация отправки запроса в веб-банк
    await new Promise(resolve => setTimeout(resolve, 900));
    
    // Форматируем телефон для показа
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 9) {
      return { success: false, maskedPhone: '', error: 'Укажите корректный номер телефона' };
    }

    const masked = `+375 (**)-***-${cleaned.slice(-4)}`;
    return { success: true, maskedPhone: masked };
  }

  static async verifyOtp(code: string, _phone: string): Promise<{
    success: boolean;
    account?: AlfaAccount;
    transactions?: AlfaTransaction[];
    sessionToken?: string;
    error?: string;
  }> {
    await new Promise(resolve => setTimeout(resolve, 1100));

    if (code.length < 4) {
      return { success: false, error: 'Неверный код из SMS. Должно быть 4-6 цифр.' };
    }

    // Возвращаем подключенный счет и свежие банковские операции за последние дни
    const mockAccount: AlfaAccount = {
      id: 'alfa-acc-smart-by',
      name: 'Пакет Smart Standard',
      number: 'BY44 ALFA 3014 8504 0000 0000',
      balance: 1482.50,
      currency: 'BYN',
      cardName: 'Mastercard Smart Standard BYN',
      maskedCard: '• • • • 8757'
    };

    const today = new Date();
    const fmt = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - offsetDays);
      return d.toISOString().split('T')[0];
    };

    const mockTransactions: AlfaTransaction[] = [
      {
        id: 'alfa-tx-live-1',
        date: fmt(0),
        amount: 24.80,
        type: 'expense',
        merchant: 'Супермаркет Евроопт',
        comment: 'Оплата картой *8757 в Магазин Евроопт Prime, Минск',
        categoryId: 'food-euroopt',
        currency: 'BYN'
      },
      {
        id: 'alfa-tx-live-2',
        date: fmt(0),
        amount: 5.50,
        type: 'expense',
        merchant: 'Кофейня Варадеро',
        comment: 'Оплата картой *8757 в Кафе/Кофе на вынос',
        categoryId: 'cafes',
        currency: 'BYN'
      },
      {
        id: 'alfa-tx-live-3',
        date: fmt(1),
        amount: 65.00,
        type: 'expense',
        merchant: 'АЗС Белоруснефть №32',
        comment: 'Оплата топлива АИ-95 картой *8757',
        categoryId: 'car',
        currency: 'BYN'
      },
      {
        id: 'alfa-tx-live-4',
        date: fmt(1),
        amount: 14.20,
        type: 'expense',
        merchant: 'Аптека Планета Здоровья',
        comment: 'Покупка медикаментов картой *8757',
        categoryId: 'medical',
        currency: 'BYN'
      },
      {
        id: 'alfa-tx-live-5',
        date: fmt(2),
        amount: 42.10,
        type: 'expense',
        merchant: 'Green Hypermarket',
        comment: 'Покупка продуктов в гипермаркете Green',
        categoryId: 'food-green',
        currency: 'BYN'
      },
      {
        id: 'alfa-tx-live-6',
        date: fmt(3),
        amount: 12.00,
        type: 'expense',
        merchant: 'A1 Мобильная связь',
        comment: 'Оплата абонентской платы тариф Безлимит',
        categoryId: 'mobile',
        currency: 'BYN'
      },
      {
        id: 'alfa-tx-live-7',
        date: fmt(4),
        amount: 8.40,
        type: 'expense',
        merchant: 'Yandex Go Такси',
        comment: 'Поездка на такси Комфорт',
        categoryId: 'transport',
        currency: 'BYN'
      },
      {
        id: 'alfa-tx-live-8',
        date: fmt(5),
        amount: 1250.00,
        type: 'income',
        merchant: 'Альфа-Банк Зачисление ЗП',
        comment: 'Зачисление зарплаты по реестру организации',
        categoryId: 'salary',
        currency: 'BYN'
      }
    ];

    return {
      success: true,
      account: mockAccount,
      transactions: mockTransactions,
      sessionToken: 'alfa-session-' + Date.now()
    };
  }
}
