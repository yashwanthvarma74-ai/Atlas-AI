'use client';

import { Button } from '@yashwanthvarma74/react/components/Button';
import { EmptyState } from '@yashwanthvarma74/react/components/EmptyState';

// Catches anything the chat pages did not expect, so a bug shows as a message and a way back, not a blank page.
export default function ChatError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      title="Something went wrong in the chat"
      description="Your conversations are safe. Try again."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
