CREATE TABLE clin.allergy_detail (
  entry_id uuid PRIMARY KEY REFERENCES clin.entry(id),
  category text NOT NULL CHECK(category IN ('medication','food','environment','other','unknown')),
  allergy_type text NOT NULL CHECK(allergy_type IN ('allergy','intolerance','unknown')),
  reaction text NOT NULL CHECK(length(btrim(reaction)) BETWEEN 3 AND 2000),
  severity text NOT NULL CHECK(severity IN ('mild','moderate','severe','unknown')),
  criticality text NOT NULL CHECK(criticality IN ('low','high','unable-to-assess')),
  information_source text NOT NULL CHECK(information_source IN ('patient','carer','clinical-record','clinician')),
  correction_reason text,
  corrected_by uuid,
  corrected_at timestamptz,
  correction_encounter_id uuid REFERENCES encounter.encounter(id),
  CHECK ((corrected_by IS NULL AND correction_reason IS NULL AND corrected_at IS NULL AND correction_encounter_id IS NULL)
    OR (corrected_by IS NOT NULL AND correction_reason IS NOT NULL AND length(btrim(correction_reason))>=3 AND corrected_at IS NOT NULL AND correction_encounter_id IS NOT NULL))
);
CREATE TABLE clin.allergy_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient(id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter(id),
  status text NOT NULL CHECK(status IN ('unknown','no-known-allergies','no-known-drug-allergies')),
  information_source text NOT NULL CHECK(information_source IN ('patient','carer','clinical-record','clinician')),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX allergy_review_patient_idx ON clin.allergy_review(patient_id,reviewed_at DESC,id DESC);
-- Review evidence is append-only, including previous negative/unknown declarations.
CREATE FUNCTION clin.protect_allergy_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Allergy reviews are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER allergy_review_immutable BEFORE UPDATE OR DELETE ON clin.allergy_review
  FOR EACH ROW EXECUTE FUNCTION clin.protect_allergy_review();
