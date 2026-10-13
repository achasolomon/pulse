-- Demo clinical seed (ONB-001 data readiness / MIG-001 Appendix C sample
-- validation, EPIC-24). Idempotent: safe to run twice. Requires the
-- demo-facility seed (CGH facility + ED/OPD/WARD departments).
-- Representative records only: 3 patients, 3 encounters, 3 notes, 1 transfer.

-- Patients (identified downstream via their MRN identifier)
INSERT INTO patient.patient (family_name, given_name, date_of_birth, sex, facility_id)
SELECT v.family, v.given, v.dob::date, v.sex, f.id
FROM org.facility AS f
CROSS JOIN (VALUES
  ('Adebayo', 'Funke', '1988-04-12', 'F'),
  ('Mensah', 'Kwame', '1975-11-03', 'M'),
  ('Okonkwo', 'Chidi', '2001-06-25', 'M')
) AS v(family, given, dob, sex)
WHERE f.code = 'CGH'
  AND NOT EXISTS (
    SELECT 1 FROM patient.patient AS p
    WHERE p.facility_id = f.id AND p.family_name = v.family
      AND p.given_name = v.given AND p.date_of_birth = v.dob::date
  );

-- MRN identifiers
INSERT INTO patient.identifier (patient_id, system, value, facility_id)
SELECT p.id, 'MRN', 'CGH-DEMO-' || p.family_name, f.id
FROM patient.patient AS p
JOIN org.facility AS f ON f.id = p.facility_id AND f.code = 'CGH'
WHERE p.family_name IN ('Adebayo', 'Mensah', 'Okonkwo')
  AND NOT EXISTS (
    SELECT 1 FROM patient.identifier i
    WHERE i.patient_id = p.id AND i.system = 'MRN'
  );

-- Encounters (deterministic start timestamps as the demo natural key)
INSERT INTO encounter.encounter (patient_id, facility_id, type, status, department_id, started_at)
SELECT p.id, f.id, v.type, v.status,
       (SELECT d.id FROM org.department d WHERE d.facility_id = f.id AND d.code = v.dept),
       v.started::timestamptz
FROM patient.patient AS p
JOIN org.facility AS f ON f.id = p.facility_id AND f.code = 'CGH'
CROSS JOIN (VALUES
  ('outpatient', 'discharged', 'OPD',  '2026-01-05 09:00:00+00'),
  ('inpatient',  'admitted',   'WARD', '2026-01-08 14:30:00+00'),
  ('emergency',  'open',       'ED',   '2026-01-10 22:15:00+00')
) AS v(type, status, dept, started)
WHERE p.family_name = (CASE v.type
    WHEN 'outpatient' THEN 'Adebayo'
    WHEN 'inpatient'  THEN 'Mensah'
    WHEN 'emergency'  THEN 'Okonkwo' END)
  AND NOT EXISTS (
    SELECT 1 FROM encounter.encounter e
    WHERE e.patient_id = p.id AND e.type = v.type
      AND e.started_at = v.started::timestamptz
  );

-- Transfer history for the admitted encounter
INSERT INTO encounter.transfer (encounter_id, from_department_id, to_department_id, from_bed, to_bed, action)
SELECT e.id,
       (SELECT d.id FROM org.department d WHERE d.facility_id = f.id AND d.code = 'ED'),
       (SELECT d.id FROM org.department d WHERE d.facility_id = f.id AND d.code = 'WARD'),
       NULL, 'W-12', 'admit'
FROM encounter.encounter AS e
JOIN org.facility AS f ON f.id = e.facility_id AND f.code = 'CGH'
JOIN patient.patient AS p ON p.id = e.patient_id AND p.family_name = 'Mensah'
WHERE e.type = 'inpatient' AND e.started_at = '2026-01-08 14:30:00+00'
  AND NOT EXISTS (
    SELECT 1 FROM encounter.transfer t
    WHERE t.encounter_id = e.id AND t.action = 'admit' AND t.to_bed = 'W-12'
  );

-- Notes: two signed (immutable clinical evidence) + one draft
INSERT INTO clin.note (patient_id, encounter_id, chief_complaint, assessment, plan, status, signed_at)
SELECT e.patient_id, e.id, v.complaint, v.assessment, v.plan, v.status,
       CASE WHEN v.status = 'signed' THEN v.signed::timestamptz ELSE NULL END
FROM encounter.encounter AS e
JOIN patient.patient AS p ON p.id = e.patient_id
CROSS JOIN (VALUES
  ('Adebayo', 'outpatient', '2026-01-05 09:00:00+00',
   'Annual review', 'Stable, no concerns', 'Repeat labs in 12 months', 'signed', '2026-01-05 09:40:00+00'),
  ('Mensah', 'inpatient', '2026-01-08 14:30:00+00',
   'Elective admission', 'Post-op stable', 'Mobilise, discharge tomorrow', 'signed', '2026-01-08 16:05:00+00'),
  ('Okonkwo', 'emergency', '2026-01-10 22:15:00+00',
   'Chest pain', 'Under observation', 'Troponin series pending', 'draft', NULL)
) AS v(patient, type, started, complaint, assessment, plan, status, signed)
WHERE p.family_name = v.patient AND e.type = v.type
  AND e.started_at = v.started::timestamptz
  AND NOT EXISTS (
    SELECT 1 FROM clin.note n
    WHERE n.encounter_id = e.id AND n.chief_complaint = v.complaint
  );
