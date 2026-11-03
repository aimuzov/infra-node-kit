import { createHmac, timingSafeEqual } from 'node:crypto'
export function verifyInitData(
	initData,
	{
		botToken,
		maxAgeSec,
		maxLength = 8192,
		nowSec = Date.now() / 1000,
		rejectFuture = false,
	},
) {
	const fail = (reason) => ({ ok: false, reason })
	if (initData === undefined || initData === null || initData === '')
		return fail('missing')
	if (typeof initData !== 'string' || initData.length > maxLength)
		return fail('malformed')
	const params = new URLSearchParams(initData)
	const hash = params.get('hash')
	if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return fail('malformed')
	const fields = [...params]
		.filter(([key]) => key !== 'hash')
		.map(([key, value]) => key + '=' + value)
		.sort()
		.join('\n')
	const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
	const expected = createHmac('sha256', secret).update(fields).digest()
	if (!timingSafeEqual(Buffer.from(hash, 'hex'), expected))
		return fail('bad-signature')
	const authDate = Number(params.get('auth_date'))
	if (!Number.isInteger(authDate) || authDate <= 0) return fail('malformed')
	const age = nowSec - authDate
	if (age > maxAgeSec || (rejectFuture && age < 0)) return fail('expired')
	try {
		const user = JSON.parse(params.get('user'))
		if (!user || typeof user !== 'object' || Array.isArray(user))
			return fail('malformed')
		return { ok: true, user, params }
	} catch {
		return fail('malformed')
	}
}
export async function sendMessages({
	token,
	recipients,
	messages,
	timeoutMs,
	fetch: fetcher = globalThis.fetch,
	timeout = AbortSignal.timeout,
}) {
	return Promise.allSettled(
		recipients.map(async (chatId) => {
			for (const text of messages) {
				let response
				try {
					response = await fetcher(
						'https://api.telegram.org/bot' + token + '/sendMessage',
						{
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								chat_id: chatId,
								text,
								parse_mode: 'HTML',
							}),
							...(timeoutMs === undefined
								? {}
								: { signal: timeout(timeoutMs) }),
						},
					)
				} catch {
					throw new Error('Telegram request failed')
				}
				let cleanupFailed = false
				try {
					await response.body?.cancel()
				} catch {
					cleanupFailed = true
				}
				if (!response.ok) throw new Error('Telegram HTTP ' + response.status)
				if (cleanupFailed) throw new Error('Telegram response cleanup failed')
			}
		}),
	)
}
