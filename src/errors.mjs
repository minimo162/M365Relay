export class BridgeError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'BridgeError'; this.code = code; this.status = status; this.details = details;
  }
}
export const assert = (ok, code, message, status = 400) => {
  if (!ok) throw new BridgeError(code, message, status);
};
export function publicError(error) {
  if (error instanceof BridgeError) return {
    type: 'bridge_error', code: error.code, message: error.message,
    ...(error.details ? { details: error.details } : {})
  };
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return {
    type: 'bridge_error', code: 'cancelled_or_timed_out',
    message: '要求は停止または期限切れになりました。送信済みか不明な要求は自動で再送しません。'
  };
  // Never serialize a browser exception, page text, prompt, path or stack to the client/log.
  return { type: 'bridge_error', code: 'internal_error', message: '内部エラーです。本文を含まない診断ログを確認してください。' };
}
export function abortReason(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
export async function delay(ms, signal) {
  abortReason(signal);
  await new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
