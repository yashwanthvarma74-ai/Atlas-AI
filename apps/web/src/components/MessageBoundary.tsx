'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Component, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

// One message that cannot be drawn (a malformed saved answer, a renderer bug) must not blank the whole
// conversation. React can only catch a render error in a class component.
export default class MessageBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <Alert variant="warning" title="This message could not be shown">
          The rest of the conversation is unaffected.
        </Alert>
      );
    }
    return this.props.children;
  }
}
