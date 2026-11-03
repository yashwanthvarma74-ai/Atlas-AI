'use client';

import { Button } from '@yashwanthvarma74/react/components/Button';
import { Textarea } from '@yashwanthvarma74/react/components/Textarea';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { QUESTION_MAX_LENGTH } from '@atlas/shared';
import styles from './ChatComposer.module.css';

interface Props {
  busy: boolean;
  // returns false when the question was refused, so it can be put back for another try
  onSend: (content: string) => Promise<boolean>;
  onStop: () => void;
}

export default function ChatComposer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);

  // after an answer, the cursor is where the next question goes
  useEffect(() => {
    if (!busy) field.current?.focus();
  }, [busy]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    // cleared at once so the box feels instant, and restored if the server turns the question down
    setText('');
    if (!(await onSend(content))) setText(content);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter starts a new line, and a key that is only choosing a character in an input
    // method (Japanese, Chinese, Korean) is left alone
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <Textarea
        ref={field}
        aria-label="Your question"
        placeholder="Ask about your documents"
        rows={2}
        maxLength={QUESTION_MAX_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        resize="none"
      />
      {busy ? (
        <Button type="button" variant="secondary" onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button type="submit" variant="primary" disabled={!text.trim()}>
          Send
        </Button>
      )}
    </form>
  );
}
