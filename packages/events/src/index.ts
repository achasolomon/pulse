export interface DomainEvent<T = unknown> {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  producer: string;
  aggregateId: string;
  correlationId?: string;
  payload: T;
}
