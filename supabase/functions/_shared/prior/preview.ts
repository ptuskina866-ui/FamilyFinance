import { type BankPreview, type PreviewRecord, type PreviewInput, bankId, dateOnly, list, moneyText, object, requiredText, PreviewError } from './model.ts';

function recordsFromDetail(detail: Record<string, unknown>, from: string, to: string): PreviewRecord[] {
  const contract = object(detail.contract), account = object(contract.account);
  const records: PreviewRecord[] = [];
  const append = (value: unknown, source: PreviewRecord['source']) => {
    for (const item of list(value)) {
      const row = object(item), rawDate = requiredText(row.transDate, 80), date = dateOnly(rawDate.slice(0, 10));
      records.push({
        date: rawDate, description: requiredText(row.transDetails, 4000),
        accountAmount: row.accountAmount == null ? null : moneyText(row.accountAmount),
        operationAmount: moneyText(row.amount), operationCurrency: requiredText(row.transCurrIso, 8),
        fee: row.feeAmount == null ? null : moneyText(row.feeAmount), source,
        outsidePeriod: date < from || date > to, possibleDuplicate: false,
      });
      if (source === 'history' && row.accountAmount == null) throw new PreviewError('AMOUNT_INVALID', 'В истории нет суммы по счёту. Проверка остановлена.');
      if (records.length > 2000) throw new PreviewError('TOO_MANY_ROWS', 'Слишком много операций. Выберите меньший период.');
    }
  };
  if (!Object.hasOwn(account, 'transCardList')) throw new PreviewError('FORMAT_CHANGED', 'В ответе отсутствует ожидаемая история счёта.');
  for (const group of list(account.transCardList ?? [])) {
    const source = object(group);
    if (!Object.hasOwn(source, 'transactionList')) throw new PreviewError('FORMAT_CHANGED', 'В ответе изменился список операций.');
    append(source.transactionList ?? [], 'history');
  }
  for (const group of list(contract.abortedContractList ?? [])) {
    const source = object(group);
    if (!Object.hasOwn(source, 'abortedTransactionList')) throw new PreviewError('FORMAT_CHANGED', 'В ответе изменился дополнительный список операций.');
    append(source.abortedTransactionList ?? [], 'additional');
  }
  const seen = new Map<string, PreviewRecord[]>();
  for (const row of records) {
    const key = JSON.stringify([row.source, row.date, row.description, row.accountAmount, row.operationAmount, row.operationCurrency, row.fee]);
    const matching = seen.get(key) || []; matching.push(row); seen.set(key, matching);
    if (matching.length > 1) matching.forEach(record => { record.possibleDuplicate = true; });
  }
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

/** Whitelist preview fields only. Bank sessions, full card/account numbers and addresses never leave the helper. */
export function makePreview(cardsValue: unknown, detailsValue: unknown, range: Pick<PreviewInput, 'from' | 'to'>): BankPreview {
  const details = list(detailsValue).map(object), seen = new Set<string>();
  const preview: BankPreview = { from: range.from, to: range.to, fetchedAt: new Date().toISOString(), cards: [], externalCards: 0 };
  for (const value of list(cardsValue)) {
    const card = object(value);
    if (card.status && object(card.status).respCode === -9999) { preview.externalCards++; continue; }
    const client = object(card.clientObject), id = bankId(client.id);
    if (seen.has(id)) throw new PreviewError('FORMAT_CHANGED', 'Банк вернул неоднозначный список карт.');
    seen.add(id);
    const detail = details.find(row => bankId(row.id) === id);
    if (!detail) throw new PreviewError('FORMAT_CHANGED', 'Не для всех карт получена история. Проверка остановлена.');
    const contract = object(detail.contract), currency = requiredText(client.currIso, 8);
    if (!/^[A-Z]{3}$/.test(currency)) throw new PreviewError('FORMAT_CHANGED', 'Не удалось проверить валюту счёта.');
    const masked = requiredText(client.cardMaskedNumber, 80).replace(/\D/g, '').slice(-4);
    preview.cards.push({
      id, title: requiredText(client.customSynonym || client.defaultSynonym || 'Карта Приорбанка', 200),
      maskedNumber: masked.length === 4 ? `•••• ${masked}` : 'Номер скрыт', currency,
      available: moneyText(object(card.balance).available), creditLimit: contract.creditLimit == null ? null : moneyText(contract.creditLimit),
      records: recordsFromDetail(detail, range.from, range.to),
    });
  }
  return preview;
}
