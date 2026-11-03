import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readBody, readJson, HttpError } from '../http.js'
import { verifyInitData, sendMessages } from '../telegram.js'
async function* body(...chunks) {
	yield* chunks
}
const token = 'secret-token'
function signed(fields) {
	const params = new URLSearchParams(fields)
	const data = [...params]
		.map(([k, v]) => `${k}=${v}`)
		.sort()
		.join(String.fromCharCode(10))
	const secret = createHmac('sha256', 'WebAppData').update(token).digest()
	params.set('hash', createHmac('sha256', secret).update(data).digest('hex'))
	return params.toString()
}
test('body uses UTF-8 bytes and accepts the exact boundary', async () => {
	assert.equal((await readBody(body('я'), { limit: 2 })).toString(), 'я')
	await assert.rejects(
		readBody(body('я'), { limit: 1 }),
		(e) => e instanceof HttpError && e.status === 413,
	)
})
test('JSON preserves scalars and optionally requires objects and permits empty bodies', async () => {
	assert.equal(await readJson(body(Buffer.from('null')), { limit: 10 }), null)
	assert.deepEqual(
		await readJson(body(), { limit: 10, emptyObject: true, objectOnly: true }),
		{},
	)
	for (const text of ['', '[1]', 'null', 'x'])
		await assert.rejects(
			readJson(body(text), { limit: 10, objectOnly: true }),
			(e) => e.status === 400,
		)
	await assert.rejects(
		readJson(body('xxxxx'), { limit: 1, tooLargeMessage: 'large' }),
		/large/,
	)
})
test('Mini App includes signature and returns raw user and start parameter', () => {
	const init = signed({
		auth_date: '100',
		user: JSON.stringify({ id: 1, first_name: 'A' }),
		signature: 'ed25519',
		start_param: 'invite',
	})
	const result = verifyInitData(init, {
		botToken: token,
		maxAgeSec: 10,
		nowSec: 110,
	})
	assert.equal(result.ok, true)
	assert.equal(result.user.id, 1)
	assert.equal(result.params.get('start_param'), 'invite')
	assert.equal(
		verifyInitData(init.replace('ed25519', 'other'), {
			botToken: token,
			maxAgeSec: 10,
			nowSec: 110,
		}).reason,
		'bad-signature',
	)
})
test('Mini App rejects malformed, expired and optionally future data', () => {
	const options = { botToken: token, maxAgeSec: 10, nowSec: 110 }
	assert.equal(verifyInitData('', options).reason, 'missing')
	assert.equal(verifyInitData('hash=x', options).reason, 'malformed')
	for (const auth_date of ['no', '0', '1.2'])
		assert.equal(
			verifyInitData(signed({ auth_date, user: '{}' }), options).reason,
			'malformed',
		)
	assert.equal(
		verifyInitData(signed({ auth_date: '99', user: '{}' }), options).reason,
		'expired',
	)
	assert.equal(
		verifyInitData(signed({ auth_date: '111', user: '{}' }), {
			...options,
			rejectFuture: true,
		}).reason,
		'expired',
	)
	assert.equal(
		verifyInitData(signed({ auth_date: '111', user: '{}' }), options).ok,
		true,
	)
	assert.equal(
		verifyInitData(signed({ auth_date: '100', user: 'null' }), options).reason,
		'malformed',
	)
})
test('fan-out keeps message order and isolates failed recipients without leaking token', async () => {
	const sent = []
	const result = await sendMessages({
		token,
		recipients: ['bad', 'good'],
		messages: ['one', 'two'],
		timeoutMs: 5,
		timeout: (ms) => {
			assert.equal(ms, 5)
			return new AbortController().signal
		},
		fetch: async (url, options) => {
			const message = JSON.parse(options.body)
			sent.push(message)
			if (message.chat_id === 'bad') throw new Error(url)
			return { ok: true }
		},
	})
	assert.equal(result[0].status, 'rejected')
	assert.equal(result[0].reason.message.includes(token), false)
	assert.equal(result[1].status, 'fulfilled')
	assert.deepEqual(
		sent.filter((x) => x.chat_id === 'good').map((x) => x.text),
		['one', 'two'],
	)
	assert.deepEqual(
		sent.filter((x) => x.chat_id === 'bad').map((x) => x.text),
		['one'],
	)
})
test('HTTP delivery failures redact response bodies', async () => {
	const result = await sendMessages({
		token,
		recipients: ['1'],
		messages: ['one'],
		fetch: async () => ({ ok: false, status: 401, text: async () => token }),
	})
	assert.equal(result[0].reason.message, 'Telegram HTTP 401')
})
