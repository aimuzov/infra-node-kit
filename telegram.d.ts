export type InitDataFailure =
	'missing' | 'malformed' | 'bad-signature' | 'expired'
export type InitDataResult =
	| { ok: true; user: Record<string, unknown>; params: URLSearchParams }
	| { ok: false; reason: InitDataFailure }
export interface InitDataOptions {
	botToken: string
	maxAgeSec: number
	maxLength?: number
	nowSec?: number
	rejectFuture?: boolean
}
export function verifyInitData(
	initData: string,
	options: InitDataOptions,
): InitDataResult
export interface SendMessagesOptions {
	token: string
	recipients: readonly (string | number)[]
	messages: readonly string[]
	timeoutMs?: number
	fetch?: typeof globalThis.fetch
	timeout?: (milliseconds: number) => AbortSignal
}
export function sendMessages(
	options: SendMessagesOptions,
): Promise<PromiseSettledResult<void>[]>
