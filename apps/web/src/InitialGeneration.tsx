import { useRef, useState } from 'react';
import { z } from 'zod';
import { lessonSchema, startOperationResponseSchema, type Lesson } from '@learnspace/shared';
import { api, envelope } from './api';

export function InitialGeneration({ topicId, onStarted, onLesson }: { topicId: string; onStarted: (id: string) => void; onLesson: (lesson: Lesson) => void }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const key = useRef<string | undefined>(undefined);
  async function start() {
    if (busy) return; setBusy(true); setMessage(''); key.current ??= crypto.randomUUID();
    try {
      const result = await api(`/topics/${topicId}/lesson-generations`, envelope(z.union([lessonSchema, startOperationResponseSchema])), 'POST', {}, { 'Idempotency-Key': key.current });
      if ('operationId' in result.data) onStarted(result.data.operationId); else onLesson(result.data);
      key.current = undefined;
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Generation start was not acknowledged.'} Retry uses the same request key.`); }
    finally { setBusy(false); }
  }
  return <section aria-label="Initial lesson generation"><p>Generate only when you choose. Opening this topic never calls a model. Blank manual notes remain available.</p><button disabled={busy} onClick={() => void start()}>Generate lesson</button>{message && <p role="alert">{message}</p>}</section>;
}
