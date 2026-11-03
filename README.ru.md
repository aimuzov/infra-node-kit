# infra-node-kit

HTTP и Telegram для Node.js 24 и новее. Без зависимостей в runtime.

Импорты: `@aimuzov/infra-node-kit/http.js` и `@aimuzov/infra-node-kit/telegram.js`.

HTTP: `HttpError(status, message)` хранит статус, `readBody(request, options)` ограничивает тело в байтах, `readJson(request, options)` разбирает JSON. Лимит `limit` обязателен. Тексты задаются через `tooLargeMessage` и `invalidJsonMessage`. Опции `emptyObject` и `objectOnly` сохраняют правила пустого тела и JSON-объектов.

Telegram: `verifyInitData(initData, options)` проверяет подпись Mini App и срок действия. Обязательны `botToken` и `maxAgeSec`; `nowSec` измеряется в секундах, `maxLength` ограничивает длину строки (по умолчанию 8192). `signature` участвует в подписи. Модель пользователя проверяет приложение. Даты из будущего разрешены по умолчанию; `rejectFuture` включает запрет. Login Widget использует другой протокол и сюда не входит.

Результат проверки: `{ok:true, user, params}` либо `{ok:false, reason}`. Причины: `missing`, `malformed`, `bad-signature`, `expired`. `user` содержит исходный JSON-объект, `params` -- подписанные поля.

`sendMessages({token, recipients, messages, timeoutMs?, fetch?, timeout?})` отправляет сообщения с HTML-разметкой по порядку каждому получателю. Получатели независимы; результат -- массив `PromiseSettledResult<void>` в исходном порядке. Приложение решает, достаточно ли частичной доставки. `fetch` и `timeout` подменяются в тестах; `timeoutMs` необязателен. Диагностика не включает токен, тело ответа и исходную сетевую ошибку.

Проверки: `npm test`, `npm run check`, `npm pack --dry-run`.

Для TypeScript установите `@types/node` в devDependencies. В TypeScript 6 и при явном списке типов добавьте `"types": ["node"]` в `compilerOptions`, сохранив остальные нужные приложению типы.

При превышении лимита `readBody` сохраняет Node readable stream и дренирует остаток тела: обработчик может отправить 413. Для остальных async iterable сохраняется обычная очистка итератора.

Очистка незаблокированного тела ответа ждёт не больше секунды. При сбое получатель получает обезличенную ошибку; HTTP-ошибка сохраняет статус. Заблокированным телом подменённого ответа управляет его reader.
