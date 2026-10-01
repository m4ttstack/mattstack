import { AGENT_STATE_WORD, type AgentState } from './agent-state';
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

/** The state's word, grey unless the agent is waiting on the human. */
export function StateWord({
  state,
  testId,
}: {
  state: AgentState;
  testId?: string;
}) {
  return (
    <span className={classes.word} data-state={state} data-testid={testId}>
      {AGENT_STATE_WORD[state]}
    </span>
  );
}
