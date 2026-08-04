import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

/**
 * Catches a render failure and says what happened.
 *
 * A blank screen is the worst possible failure mode for an operating
 * environment: it gives the user nothing to act on and the developer nothing to
 * search for. This is the same reason `sairios-session` prints a banner instead
 * of leaving a black tty when the product tree is missing.
 *
 * It is a class component because React still offers no hook equivalent of
 * componentDidCatch.
 */
export class Boundary extends Component<
  { children: ReactNode },
  { error: Error | null; stack: string }
> {
  override state = { error: null as Error | null, stack: '' };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, stack: info.componentStack ?? '' });
    // Keep it in the console too: the on-screen copy is for the user, this one
    // is for whoever has devtools open.
    console.error('Sairi OS failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="sairi s-fault" role="alert">
        <h1>Sairi could not render this context.</h1>
        <p className="s-fault__msg">{error.message}</p>
        {stack && (
          <pre className="s-fault__stack">{stack.trim().split('\n').slice(0, 8).join('\n')}</pre>
        )}
        <button
          className="s-btn"
          onClick={() => this.setState({ error: null, stack: '' })}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }
}

export function faultStyles(): JSX.Element | null {
  return null;
}
