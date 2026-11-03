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

test('oversized IncomingMessage still lets the handler send 413', async (t) => {
	const { createServer, request } = await import('node:http')
	const server = createServer(async (req, res) => {
		try {
			await readBody(req, { limit: 2 })
			res.end('ok')
		} catch (error) {
			res.writeHead(error.status ?? 500)
			res.end(JSON.stringify({ destroyed: req.destroyed }))
		}
	})
	t.after(() => {
		server.closeAllConnections()
		server.close()
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const response = await new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: '127.0.0.1',
				port: server.address().port,
				method: 'POST',
				headers: { 'content-length': '1000' },
			},
			(res) => {
				let text = ''
				res.setEncoding('utf8')
				res.on('data', (chunk) => {
					text += chunk
				})
				res.on('end', () => {
					req.end()
					resolve({ status: res.statusCode, text })
				})
			},
		)
		req.on('error', reject)
		req.write('large')
	})
	assert.deepEqual(response, { status: 413, text: '{"destroyed":false}' })
})
test('Mini App returns a failure for non-string inputs', () => {
	const options = { botToken: token, maxAgeSec: 10, nowSec: 110 }
	for (const input of [null, undefined, ''])
		assert.deepEqual(verifyInitData(input, options), {
			ok: false,
			reason: 'missing',
		})
	for (const input of [false, 0, 1, {}, [1], Symbol('data')])
		assert.deepEqual(verifyInitData(input, options), {
			ok: false,
			reason: 'malformed',
		})
})
test('fan-out releases real response streams for successful and failed requests', async () => {
	const cancelled = []
	const results = await sendMessages({
		token,
		recipients: ['good', 'bad'],
		messages: ['one'],
		fetch: async (_url, init) => {
			const id = JSON.parse(init.body).chat_id
			return new Response(
				new ReadableStream({
					cancel() {
						cancelled.push(id)
					},
				}),
				{ status: id === 'good' ? 200 : 401 },
			)
		},
	})
	assert.deepEqual(cancelled.sort(), ['bad', 'good'])
	assert.equal(results[0].status, 'fulfilled')
	assert.equal(results[1].reason.message, 'Telegram HTTP 401')
})
test('cleanup failures are redacted and preserve HTTP failure status', async () => {
	const results = await sendMessages({
		token,
		recipients: ['good', 'bad'],
		messages: ['one'],
		fetch: async (_url, init) => {
			const id = JSON.parse(init.body).chat_id
			return new Response(
				new ReadableStream({
					cancel() {
						throw new Error(token)
					},
				}),
				{ status: id === 'good' ? 200 : 401 },
			)
		},
	})
	assert.equal(results[0].reason.message, 'Telegram response cleanup failed')
	assert.equal(results[1].reason.message, 'Telegram HTTP 401')
})

test(
	'oversized request drains before another keep-alive request',
	{ timeout: 5000 },
	async (t) => {
		const { createServer, request, Agent } = await import('node:http')
		const { setTimeout: delay } = await import('node:timers/promises')
		let resolveDrained
		const drained = new Promise((resolve) => {
			resolveDrained = resolve
		})
		const server = createServer(async (req, res) => {
			if (req.method === 'GET') {
				res.end('next')
				return
			}
			req.once('end', resolveDrained)
			try {
				await readBody(req, { limit: 2 })
			} catch (error) {
				res.statusCode = error.status
			}
			res.end('too large')
		})
		const agent = new Agent({ keepAlive: true, maxSockets: 1 })
		t.after(() => {
			agent.destroy()
			server.closeAllConnections()
			server.close()
		})
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
		const options = {
			hostname: '127.0.0.1',
			port: server.address().port,
			agent,
		}
		const call = (method, data) =>
			new Promise((resolve, reject) => {
				const req = request({ ...options, method }, (res) => {
					const socket = res.socket
					let text = ''
					res.setEncoding('utf8')
					res.on('data', (chunk) => {
						text += chunk
					})
					res.on('end', () => resolve({ status: res.statusCode, text, socket }))
				})
				req.on('error', reject)
				req.end(data)
			})
		const first = await call('POST', Buffer.alloc(4 * 1024 * 1024))
		assert.equal(first.status, 413)
		assert.equal(
			await Promise.race([
				drained.then(() => true),
				delay(1000).then(() => false),
			]),
			true,
		)
		const second = await call('GET')
		assert.equal(second.text, 'next')
		assert.equal(second.socket, first.socket)
	},
)
test(
	'cloned response cleanup cannot keep delivery pending',
	{ timeout: 4000 },
	async (t) => {
		const { setTimeout: delay } = await import('node:timers/promises')
		const original = new Response(new ReadableStream())
		const clone = original.clone()
		t.after(() => {
			void original.body.cancel()
		})
		const delivery = sendMessages({
			token,
			recipients: ['one'],
			messages: ['message'],
			fetch: async () => clone,
		})
		const results = await Promise.race([delivery, delay(1500).then(() => null)])
		assert.notEqual(results, null)
		assert.equal(results[0].reason.message, 'Telegram response cleanup failed')
	},
)
test('locked injected response bodies belong to their reader and do not stop later messages', async (t) => {
	const readers = []
	t.after(() => Promise.all(readers.map((reader) => reader.cancel())))
	let sent = 0
	const results = await sendMessages({
		token,
		recipients: ['one'],
		messages: ['first', 'second'],
		fetch: async () => {
			sent++
			const response = new Response(new ReadableStream())
			readers.push(response.body.getReader())
			return response
		},
	})
	assert.equal(results[0].status, 'fulfilled')
	assert.equal(sent, 2)
})
