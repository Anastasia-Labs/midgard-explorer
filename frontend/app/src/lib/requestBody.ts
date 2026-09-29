export class RequestBodyError extends Error {
  constructor(readonly status: 400 | 408 | 413) {
    super(`Request body rejected (${status})`);
  }
}

/** Bound bytes while streaming; Content-Length is optional and untrusted. */
export async function readLimitedText(request: Request, maxBytes: number, timeoutMs: number) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestBodyError(408)), timeoutMs);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) return new TextDecoder().decode(bytes.subarray(0, length));
      if (value.byteLength > maxBytes - length) throw new RequestBodyError(413);
      bytes.set(value, length);
      length += value.byteLength;
    }
  } catch (error) {
    // Cancellation must not delay the refusal if the sender stops responding.
    void reader.cancel().catch(() => {});
    throw error instanceof RequestBodyError ? error : new RequestBodyError(400);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
