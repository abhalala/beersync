export class BodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Body exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
    this.name = "BodyTooLargeError";
  }
}

/** Wrap a byte stream so it errors as soon as more than `maxBytes` flow through it */
export function limitStream(stream: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new BodyTooLargeError(maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
}

/** Read a stream fully into memory (callers should have limited it first) */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function toUint8Array(body: ArrayBuffer | Uint8Array): Uint8Array {
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}
