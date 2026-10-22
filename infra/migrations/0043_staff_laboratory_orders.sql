CREATE TABLE lab.facility_test (
  facility_id uuid NOT NULL REFERENCES org.facility(id),
  test_id uuid NOT NULL REFERENCES lab.test(id),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(facility_id,test_id)
);
ALTER TABLE lab.lab_order
  ADD COLUMN ordered_by uuid,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
  ADD COLUMN cancelled_by uuid,
  ADD COLUMN cancelled_at timestamptz;
