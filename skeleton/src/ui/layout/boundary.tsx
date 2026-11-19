// Error boundary per panel, live regions, landmarks and the primary actions bar.
import { Component, Fragment } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import type { StoreLike, StudioActions } from '../tablet/actions.js';
import { useStudio } from '../tablet/actions.js';
import { SummonAllButton } from '../tablet/tablet.js';

export const RELOAD_PANEL = 'Reload this panel';
export const panelFailedText = (message: string): string => `This panel failed to draw: ${message}`;

interface BoundaryState { error: Error | undefined; generation: number }

export class PanelErrorBoundary extends Component<{ name: string; children: ReactNode; onError?(e: Error): void }, BoundaryState> {
  override state: BoundaryState = { error: undefined, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> { return { error }; }

  override componentDidCatch(error: Error, _info: ErrorInfo): void { this.props.onError?.(error); }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="golem-panel-error" data-panel={this.props.name}>
          <p>{panelFailedText(this.state.error.message)}</p>
          <button type="button" className="golem-btn" onClick={() => this.setState((s) => ({ error: undefined, generation: s.generation + 1 }))}>
            {RELOAD_PANEL}
          </button>
        </div>
      );
    }
    return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
  }
}

/** Polite status and alert regions. The Announcer writes into them; focus never moves. */
export function LiveRegions({ politeId, alertId }: { politeId: string; alertId: string }) {
  return (
    <>
      <div id={politeId} className="golem-sr-only" aria-live="polite" aria-atomic="true" />
      <div id={alertId} className="golem-sr-only" role="alert" aria-atomic="true" />
    </>
  );
}

export function ActionsBar({ store, actions }: { store: StoreLike; actions: StudioActions }) {
  const theme = useStudio(store, (s) => s.theme);
  const hero = useStudio(store, (s) => s.hero);
  return (
    <section className="golem-actions" aria-label="Studio actions">
      <SummonAllButton store={store} actions={actions} />
      <button type="button" className="golem-btn" onClick={() => actions.reset()} disabled={hero === 'loading' || hero === 'failed' || hero === 'no-webgl'}>
        Reset the robot
      </button>
      <button type="button" className="golem-btn" aria-pressed={theme === 'light'} onClick={() => actions.toggleTheme()}>
        Light theme
      </button>
    </section>
  );
}

export function Messages({ store }: { store: StoreLike }) {
  const messages = useStudio(store, (s) => s.messages);
  if (messages.length === 0) return null;
  return (
    <ul className="golem-messages" aria-label="Studio messages">
      {messages.map((m) => <li key={m.id} className={`golem-msg-${m.kind}`}>{m.text}</li>)}
    </ul>
  );
}
