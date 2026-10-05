export interface SseEvent {
  event?: string;
  data: string;
}

/** Parses a text/event-stream body into events. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (chunk: string): SseEvent | null => {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) event = line.slice(6).trim();
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer);
        if (!match) break;
        const chunk = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const parsed = parse(chunk);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    const parsed = buffer.trim() ? parse(buffer) : null;
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

/** Removes `<think>` sections some open models emit before their answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart();
}
