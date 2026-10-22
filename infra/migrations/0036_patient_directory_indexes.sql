-- Stable, facility-scoped staff directory pagination.
CREATE INDEX IF NOT EXISTS patient_facility_status_id_idx ON patient.patient(facility_id,status,id);
CREATE INDEX IF NOT EXISTS patient_facility_id_idx ON patient.patient(facility_id,id);
