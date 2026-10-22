ALTER TABLE lab.specimen ADD COLUMN collected_by uuid,
  ADD COLUMN identity_confirmed boolean;
-- New scoped workflow identities do not invent uniqueness/attestation for historic specimens.
CREATE TABLE lab.specimen_identity (
  specimen_id uuid PRIMARY KEY REFERENCES lab.specimen(id),
  facility_id uuid NOT NULL REFERENCES org.facility(id),
  label text NOT NULL CHECK(length(btrim(label)) BETWEEN 3 AND 100)
);
CREATE UNIQUE INDEX specimen_identity_label_uidx ON lab.specimen_identity(facility_id,lower(btrim(label)));
CREATE TABLE lab.specimen_accession (
  specimen_id uuid PRIMARY KEY REFERENCES lab.specimen(id),
  facility_id uuid NOT NULL REFERENCES org.facility(id),
  accession_number text NOT NULL CHECK(length(btrim(accession_number)) BETWEEN 3 AND 100),
  received_at timestamptz NOT NULL,
  received_by uuid NOT NULL,
  identity_confirmed boolean NOT NULL CHECK(identity_confirmed),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX specimen_accession_number_uidx ON lab.specimen_accession(facility_id,lower(btrim(accession_number)));
