/**
 * Equipment / asset domain (EPIC-25, INV-001 section 40). Assets are durable
 * medical equipment commissioned from procurement: serial identity, downtime
 * and preventive maintenance / calibration lifecycle live here. Disposal of an
 * asset is coordinated with — but distinct from — inventory stock write-off.
 */

export type AssetStatus = 'in_service' | 'out_of_service' | 'retired';
export type MaintenanceKind = 'preventive' | 'calibration' | 'corrective';
export type MaintenanceStatus = 'scheduled' | 'completed' | 'cancelled';

export interface Asset {
  id: string;
  facilityId: string;
  name: string;
  manufacturer: string;
  model: string;
  serial: string;
  purchaseOrderId?: string;
  status: AssetStatus;
  commissionedAt: string;
  outOfServiceReason?: string;
  outOfServiceSince?: string;
  retiredAt?: string;
}

export interface MaintenanceTask {
  id: string;
  assetId: string;
  kind: MaintenanceKind;
  dueAt: string;
  status: MaintenanceStatus;
  intervalDays?: number;
  completedAt?: string;
  completedNote?: string;
}

export const EQUIPMENT_REPOSITORY = 'EQUIPMENT_REPOSITORY';

export interface EquipmentRepository {
  createAsset(input: {
    facilityId: string;
    name: string;
    manufacturer: string;
    model: string;
    serial: string;
    purchaseOrderId?: string;
  }): Promise<Asset>;
  findAssetBySerial(serial: string): Promise<Asset | undefined>;
  getAsset(id: string): Promise<Asset | undefined>;
  listAssets(filter: { facilityId?: string; status?: AssetStatus }): Promise<Asset[]>;
  updateAsset(
    id: string,
    input: {
      status?: AssetStatus;
      outOfServiceReason?: string | null;
      outOfServiceSince?: Date | null;
      retiredAt?: Date;
    },
  ): Promise<void>;
  createTask(input: {
    assetId: string;
    kind: MaintenanceKind;
    dueAt: string;
    intervalDays?: number;
  }): Promise<MaintenanceTask>;
  getTask(id: string): Promise<MaintenanceTask | undefined>;
  listTasks(filter: { assetId?: string; status?: MaintenanceStatus }): Promise<MaintenanceTask[]>;
  updateTask(
    id: string,
    input: { status?: MaintenanceStatus; completedAt?: Date; completedNote?: string },
  ): Promise<void>;
  cancelOpenTasks(assetId: string): Promise<number>;
}

/** Asset lifecycle: downtime is reversible, retirement is terminal. */
export const ASSET_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  in_service: ['out_of_service', 'retired'],
  out_of_service: ['in_service', 'retired'],
  retired: [],
};

export function canTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
): boolean {
  return (table[from] ?? []).includes(to);
}

/** Overdue is derived from the clock — a scheduled task past due. */
export function isOverdue(
  task: Pick<MaintenanceTask, 'status' | 'dueAt'>,
  now: Date = new Date(),
): boolean {
  return task.status === 'scheduled' && new Date(task.dueAt).getTime() < now.getTime();
}
