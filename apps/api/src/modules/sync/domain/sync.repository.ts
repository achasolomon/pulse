/** Edge sync domain (ARCH-001 section 13, EPIC-21 foundation). */

export interface FeedCursor {
  lastCreatedAt?: string;
  lastId?: string;
}

/** Opaque cursor encoding (base64url of JSON). Empty string = from the beginning. */
export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): FeedCursor {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { lastCreatedAt, lastId } = parsed as Record<string, unknown>;
    return {
      ...(typeof lastCreatedAt === 'string' ? { lastCreatedAt } : {}),
      ...(typeof lastId === 'string' ? { lastId } : {}),
    };
  } catch {
    throw new Error('SYNC_CURSOR_INVALID');
  }
}

export interface SyncEvent {
  eventId: string;
  type: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export type ConflictReason =
  | 'DUPLICATE_PATIENT'
  | 'UNKNOWN_PATIENT'
  | 'UNKNOWN_ENCOUNTER'
  | 'UNKNOWN_TYPE';

export const SYNC_REPOSITORY = 'SYNC_REPOSITORY';

export interface SyncRepository {
  feed(
    since: FeedCursor,
    limit: number,
    capabilities?: string[],
  ): Promise<{ events: SyncEvent[]; cursor: FeedCursor }>;
  isApplied(eventId: string): Promise<boolean>;
  markApplied(eventId: string): Promise<void>;
  openConflict(input: {
    eventId: string;
    eventType: string;
    aggregateId: string;
    reason: ConflictReason;
  }): Promise<{ id: string }>;
  resolveConflict(id: string, resolution: string): Promise<void>;
  findOpen(limit?: number): Promise<{ id: string; eventType: string; reason: ConflictReason }[]>;
  watermark(consumerId: string): Promise<FeedCursor>;
  saveWatermark(consumerId: string, cursor: FeedCursor): Promise<void>;
}
