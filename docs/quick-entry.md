# One-phrase entry · 2026-10-26

First release of the approved progression: one-phrase entry, then currency accounts, then splitting a purchase. This release implements the first item only; the currency and split financial models remain separate follow-up work.

## Behavior

Add → One phrase accepts typed text or browser dictation. A deterministic local parser prepares one cash expense, income or transfer between the user's existing accounts. It does not use an LLM, call a bank, or write on recognition. The compact preview shows amount, category, account and date. Edit details exposes the existing category catalogue, date, note and accounts before explicit saving. Unknown category/account choices remain empty rather than guessed.

Examples: `Кофе пять пятьдесят наличными`, `Вчера получил двести наличными за подработку`, `Снял сто с карты в наличные`. Decimal commas/points, correctly grouped thousands, common Russian integers and ruble/kopeck amounts retain exact minor units. Supported date phrases are today/yesterday/the day before yesterday, ISO dates and DD.MM.YYYY. Multiple amounts, negative/zero/overprecise/oversized amounts, invalid dates, debt and foreign-currency phrases cannot save. Explicit transfers are recorded as one existing transfer RPC, not a cash expense. Bank-account manual entries display a reminder to check for an already imported operation.

The original form stays available below the one-phrase block. Removed its mount-time autofocus to keep the new entry visible on phones. Existing household-aware `addTransaction` and `transferBetweenAccounts` are reused. A synchronous in-flight guard prevents a double-click from issuing two mutations. Network failures retain the draft, do not retry automatically, and ask the user to inspect the journal before retrying; this does not introduce durable request idempotency across reloads. Existing bank duplicate reconciliation is unchanged.

## Speech and privacy

Feature-detect both `SpeechRecognition` and Safari's `webkitSpeechRecognition`; request Russian, a single utterance, final results. FinApp never records/stores/uploads audio itself. The browser's recognition service may process audio remotely, which is stated next to the microphone. Permission/service/network/no-speech errors fall back to text or keyboard dictation. Abort and remove handlers on unmount/background; a 25-second timeout prevents a stuck listening state. Speech availability in an installed iPhone PWA depends on the device/browser/service; runtime detection is not proof of successful dictation.

References checked: [MDN API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [MDN compatibility source](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json). Browser speech is not an offline guarantee. Text parsing is local; saving uses the existing authenticated backend and needs a connection.

## Verification

- Four parser tests added to `npm test` (79 total): exact numbers, malformed/ambiguous input, dates, income/categories, transfers and ambiguous accounts; includes Euroopt versus euro and incoming `перевели` versus outgoing `перевёл`.
- `tests/quick-entry-ui.js` exercises real AppProvider/AddTransactionScreen at 320/390 px with synthetic intercepted APIs only: no write before confirmation, one mutation on double-click, expense/income, transfer preserving capital, missing categories, network error draft retention, prefixed/unprefixed speech, denied microphone, cleanup and absent API fallback. No working household data is written by these tests.
- Physical iPhone dictation and the owner's first saved phrase remain owner verification.
- No database, RLS, bank-worker, credential, schema or dependency changes.
- Full `npm test` passes (79), `npm run test:prior` passes (38), strict TypeScript/Vite/PWA build passes. Existing bank live and remembered-connection mobile suites pass at 320/390 px. New UI also saves through the original manual form. Screenshots inspected at both widths; no runtime errors or horizontal overflow. The existing large main-bundle warning remains.

Changed code: `src/lib/quickEntry.ts`, `src/components/QuickEntry.tsx`, `src/screens/AddTransactionScreen.tsx`; parser runner and the two tests above. Project/task documentation records delivery and remaining roadmap.
