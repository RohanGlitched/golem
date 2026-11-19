// The "Controller: Unitree's policy / + Kiro's reflex" control above the G1 studio. It is a group of two toggle buttons.
import { CONTROLLER_LABELS, type ControllerChoice, type ControllerKind } from './stagger-controller';

const KINDS: ControllerKind[] = ['none', 'kiro'];
const NOTE: Record<ControllerKind, string> = {
  none: 'The live robot and every ghost you summon run Unitree\u2019s policy alone.',
  kiro: 'The live robot restarted with Kiro\u2019s reflex on top of the policy. Summon again to test it; verdicts shown from earlier runs are for the other controller.',
};
const INITIAL_NOTE = 'Applies to the live robot and to every ghost you summon next.';

/** Puts the control in front of `host`. Returns a function that removes it. `afterChange` runs once the choice is applied (the studio resets the live robot there). */
export function mountControllerBar(host: HTMLElement, choice: ControllerChoice, afterChange: () => void): () => void {
  const doc = host.ownerDocument;
  const bar = doc.createElement('div');
  bar.className = 'studio-controller';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Controller');

  const label = doc.createElement('span');
  label.className = 'studio-controller-label';
  label.textContent = 'Controller:';
  bar.append(label);

  const buttons = new Map<ControllerKind, HTMLButtonElement>();
  for (const kind of KINDS) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = CONTROLLER_LABELS[kind];
    b.dataset['controller'] = kind;
    b.addEventListener('click', () => {
      if (choice.current() === kind) return;
      choice.choose(kind);
      paint(true);
      afterChange();
    });
    buttons.set(kind, b);
    bar.append(b);
  }

  const note = doc.createElement('span');
  note.className = 'studio-controller-note';
  note.setAttribute('aria-live', 'polite');
  bar.append(note);

  function paint(changed: boolean): void {
    for (const [kind, b] of buttons) b.setAttribute('aria-pressed', String(choice.current() === kind));
    note.textContent = changed ? NOTE[choice.current()] : INITIAL_NOTE;
  }
  paint(false);

  host.insertAdjacentElement('beforebegin', bar);
  return () => bar.remove();
}
