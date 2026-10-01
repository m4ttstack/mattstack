import type { AgentState } from './agent-state';
import classes from './state-dot.module.css';

export function StateDot({
  state,
  size,
  testId,
}: {
  state: AgentState;
  size?: 'sm';
  testId?: string;
}) {
  return (
    <span
      className={classes.dot}
      data-state={state}
      data-size={size}
      data-testid={testId}
      aria-hidden
    />
  );
}
