import type { Buffer } from 'node:buffer'
export class HttpError extends Error {
	readonly status: number
	constructor(status: number, message: string)
}
export interface BodyOptions {
	limit: number
	tooLargeMessage?: string
}
export interface JsonOptions extends BodyOptions {
	invalidJsonMessage?: string
	emptyObject?: boolean
	objectOnly?: boolean
}
export function readBody(
	request: AsyncIterable<Uint8Array | string>,
	options: BodyOptions,
): Promise<Buffer>
export function readJson(
	request: AsyncIterable<Uint8Array | string>,
	options: JsonOptions & { objectOnly: true },
): Promise<Record<string, unknown>>
export function readJson(
	request: AsyncIterable<Uint8Array | string>,
	options: JsonOptions,
): Promise<unknown>
