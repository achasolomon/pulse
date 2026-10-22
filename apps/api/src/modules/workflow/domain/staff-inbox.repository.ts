export const STAFF_INBOX_REPOSITORY = 'STAFF_INBOX_REPOSITORY';
export interface InboxScope {
  personId: string;
  facilityId: string;
  organizationId: string;
}
export interface StaffNotification {
  id: string;
  taskId: string;
  category: 'task';
  priority: 'normal';
  title: string;
  createdAt: string;
  readAt: string | null;
}
export interface InboxPage {
  items: StaffNotification[];
  unreadCount: number;
  nextCursor: string | null;
}
export interface AssignedTask {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
}
export interface StaffInboxRepository {
  list(
    scope: InboxScope,
    unreadOnly: boolean,
    cursor?: string,
  ): Promise<InboxPage>;
  read(scope: InboxScope, id: string): Promise<boolean>;
  createAssigned(
    scope: InboxScope,
    input: { kind: string; assigneeId: string },
  ): Promise<{ id: string }>;
  task(scope: InboxScope, id: string): Promise<AssignedTask | undefined>;
  deliverBatch(): Promise<number>;
}
