/** Workflow domain (ARCH-001 sections 22-23, EPIC-15). */

export type TaskStatus = 'open' | 'done' | 'escalated' | 'cancelled';

export function transitionTask(
  from: TaskStatus,
  action: 'complete' | 'escalate' | 'cancel',
): TaskStatus {
  const next: Record<string, TaskStatus> = {
    'open:complete': 'done',
    'open:escalate': 'escalated',
    'open:cancel': 'cancelled',
  };
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`TASK_TRANSITION:${from}->${action}`);
  return to;
}

export const WORKFLOW_REPOSITORY = 'WORKFLOW_REPOSITORY';

export interface WorkflowRepository {
  createTask(input: {
    kind: string;
    patientId?: string;
    facilityId: string;
    payload: Record<string, unknown>;
    dueAt?: string;
  }): Promise<{ id: string; status: TaskStatus }>;
  findTask(id: string): Promise<{ id: string; status: TaskStatus } | undefined>;
  setTaskStatus(id: string, status: TaskStatus): Promise<void>;
  openTasks(facilityId: string, limit: number): Promise<{ id: string; kind: string }[]>;
  notify(input: { channel: 'in-app' | 'sms' | 'email'; recipient: string; body: string }): Promise<{ id: string }>;
}
