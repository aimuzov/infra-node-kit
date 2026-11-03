export class HttpError extends Error {
	constructor(status, message) {
		super(message)
		this.name = 'HttpError'
		this.status = status
	}
}
export async function readBody(
	request,
	{ limit, tooLargeMessage = 'Request body too large' } = {},
) {
	if (!Number.isSafeInteger(limit) || limit < 0)
		throw new RangeError('limit must be a non-negative safe integer')
	const chunks = []
	let size = 0
	for await (const chunk of request) {
		const bytes = Buffer.from(chunk)
		size += bytes.length
		if (size > limit) throw new HttpError(413, tooLargeMessage)
		chunks.push(bytes)
	}
	return Buffer.concat(chunks)
}
export async function readJson(request, options) {
	const text = (await readBody(request, options)).toString('utf8')
	try {
		const result = JSON.parse(text || (options.emptyObject ? '{}' : ''))
		if (
			options.objectOnly &&
			(result === null || typeof result !== 'object' || Array.isArray(result))
		)
			throw new Error()
		return result
	} catch {
		throw new HttpError(400, options.invalidJsonMessage ?? 'Invalid JSON body')
	}
}
