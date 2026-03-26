import { useTranslation } from "react-i18next";
import { AgentStepInfo } from '../../types/agent.types';
import classes from './ai-creator-agent-steps.module.css';

interface Props {
  steps: AgentStepInfo[];
}

const STATUS_ICONS: Record<string, string> = {
  done: '✅',
  running: '🔄',
  error: '❌',
  pending: '⏳',
};

export function AiCreatorAgentSteps({ steps }: Props) {
  const { t } = useTranslation();
  if (steps.length === 0) return null;

  return (
    <div className={classes.stepsContainer}>
      <div className={classes.stepsHeader}>{t("Execution steps")}</div>
      {steps.map((step, idx) => (
        <div key={idx} className={classes.stepItem} data-status={step.status}>
          <span className={classes.stepIcon}>{STATUS_ICONS[step.status] || '⏳'}</span>
          <span className={classes.stepText}>
            {step.description}
            {step.resultSummary && step.status === 'done' && (
              <span className={classes.stepSummary}> — {step.resultSummary}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
