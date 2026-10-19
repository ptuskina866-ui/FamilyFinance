import { createHash } from 'node:crypto';
import { PreviewError, type BankPreview } from '../_shared/prior/model.ts';
/** No bank IDs, balances, sessions or unknown upstream fields cross the public API. */
export function connectionResult(preview: BankPreview) {
  if (preview.cards.length > 20) throw new PreviewError('TOO_MANY_ROWS', 'Слишком много карт в ответе банка. Проверка остановлена.');
  const cards = preview.cards.map(card => ({
    format: 'finapp-prior', version: 1, from: preview.from, to: preview.to, fetchedAt: preview.fetchedAt,
    card: { sourceKey: createHash('sha256').update(JSON.stringify(['prior-card-v1', card.id, card.currency])).digest('hex'),
      title: card.title, maskedNumber: card.maskedNumber, currency: card.currency,
      records: card.records.map(row => ({date: row.date, description: row.description, accountAmount: row.accountAmount,
        operationAmount: row.operationAmount, operationCurrency: row.operationCurrency, fee: row.fee, source: row.source})) },
  }));
  const encoded = JSON.stringify({format: 'finapp-prior-connection', version: 1, cards, externalCards: preview.externalCards});
  if (new TextEncoder().encode(encoded).length > 8_000_000) throw new PreviewError('RESPONSE_TOO_LARGE', 'История слишком большая. Выберите меньший период.');
  return encoded;
}
