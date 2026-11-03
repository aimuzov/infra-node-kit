# infra-node-kit

HTTP and Telegram primitives for Node.js 24 and newer. No runtime dependencies.

Import `@aimuzov/infra-node-kit/http.js` or `@aimuzov/infra-node-kit/telegram.js`.

`HttpError(status, message)` carries an HTTP status. `readBody(request, options)` reads an async iterable with a required byte `limit`. `readJson(request, options)` parses its UTF-8 body. Customize `tooLargeMessage` and `invalidJsonMessage`. Enable `emptyObject` to parse an empty body as {}, and `objectOnly` to reject arrays, null and primitives.

`verifyInitData(initData, options)` validates Telegram Mini App HMAC and age. Supply `botToken` and `maxAgeSec`; optional `nowSec` uses seconds, and `maxLength` defaults to 8192 characters. The signed string includes `signature`. Future dates are accepted unless `rejectFuture` is enabled. Login Widget is a separate protocol and is not handled here. Applications validate their own user models.

The result is `{ok:true, user, params}` or `{ok:false, reason}`, where reason is `missing`, `malformed`, `bad-signature` or `expired`. The user is the raw JSON object; params contains the signed fields.

`sendMessages({token, recipients, messages, timeoutMs?, fetch?, timeout?})` sends HTML messages sequentially per recipient, with independent recipients. It returns `PromiseSettledResult<void>[]` in recipient order. Applications decide whether partial delivery is sufficient. Fetch and timeout are injectable; timeoutMs is optional. Diagnostics omit tokens, response bodies and original network errors.

Run `npm test`, `npm run check` and `npm pack --dry-run`.

TypeScript consumers need `@types/node` as a development dependency. Add `"types": ["node"]` to `compilerOptions` when using TypeScript 6 or an explicit types list; also retain any other types your application needs.

On an oversized Node readable request, `readBody` preserves the stream and drains the remaining body so the handler can send 413. Generic async iterables keep their usual iterator cleanup behavior.
