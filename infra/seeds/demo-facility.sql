-- Demo facility seed (ONB-001, EPIC-24 partial). Idempotent: safe to run twice.
-- Usage: psql $DATABASE_URL -f infra/seeds/demo-facility.sql
-- Seeds a City General-style demo facility: org, departments, catalogues,
-- one demo payer with a tariff. No patients (registered per demo script).

-- Organization + facility
INSERT INTO org.organization (name, code)
SELECT 'Demo Health Group', 'DEMO-GRP'
WHERE NOT EXISTS (SELECT 1 FROM org.organization WHERE code = 'DEMO-GRP');

INSERT INTO org.facility (organization_id, name, code)
SELECT o.id, 'City General Hospital', 'CGH'
FROM org.organization AS o
WHERE o.code = 'DEMO-GRP'
  AND NOT EXISTS (
    SELECT 1 FROM org.facility AS f
    WHERE f.organization_id = o.id AND f.code = 'CGH'
  );

-- Departments
INSERT INTO org.department (facility_id, name, code)
SELECT f.id, d.name, d.code
FROM org.facility AS f
CROSS JOIN (VALUES
  ('Emergency', 'ED'),
  ('Outpatient', 'OPD'),
  ('General Ward', 'WARD'),
  ('Laboratory', 'LAB'),
  ('Pharmacy', 'PHARM'),
  ('Radiology', 'RAD')
) AS d(name, code)
WHERE f.code = 'CGH'
  AND NOT EXISTS (
    SELECT 1 FROM org.department AS x
    WHERE x.facility_id = f.id AND x.code = d.code
  );

-- Lab catalogue (version 1)
INSERT INTO lab.test (code, name, specimen_requirement, version)
SELECT v.code, v.name, v.spec, 1
FROM (VALUES
  ('FBC', 'Full Blood Count', 'EDTA'),
  ('HBA1C', 'HbA1c', 'EDTA'),
  ('LIPID', 'Lipid Profile', 'Serum'),
  ('UEC', 'Urea and Electrolytes', 'Serum')
) AS v(code, name, spec)
WHERE NOT EXISTS (SELECT 1 FROM lab.test AS t WHERE t.code = v.code AND t.version = 1);

-- Medication catalogue (version 1)
INSERT INTO med.medication (code, name, dose_form, strength, route, version)
SELECT v.code, v.name, v.form, v.strength, v.route, 1
FROM (VALUES
  ('AMOX-500', 'Amoxicillin', 'capsule', '500mg', 'oral'),
  ('MET-500', 'Metformin', 'tablet', '500mg', 'oral'),
  ('ATORVA-20', 'Atorvastatin', 'tablet', '20mg', 'oral'),
  ('LISIN-10', 'Lisinopril', 'tablet', '10mg', 'oral')
) AS v(code, name, form, strength, route)
WHERE NOT EXISTS (SELECT 1 FROM med.medication AS m WHERE m.code = v.code AND m.version = 1);

-- Billable services
INSERT INTO rev.service (code, name, default_price)
SELECT v.code, v.name, v.price
FROM (VALUES
  ('CONSULT', 'Consultation', 5000),
  ('BED-DAY', 'Bed day', 20000),
  ('FBC', 'Full Blood Count', 3500),
  ('CT-ABD', 'CT Abdomen', 85000)
) AS v(code, name, price)
WHERE NOT EXISTS (SELECT 1 FROM rev.service AS s WHERE s.code = v.code);

-- Demo payer + contract + tariff v1 (matches CONSULT demo price used in specs)
INSERT INTO ins.payer (code, name)
SELECT 'DEMO-HMO', 'Demo HMO'
WHERE NOT EXISTS (SELECT 1 FROM ins.payer WHERE code = 'DEMO-HMO');

INSERT INTO ins.facility_contract (facility_id, payer_id, effective_from)
SELECT f.id, p.id, '2024-01-01'
FROM org.facility AS f, ins.payer AS p
WHERE f.code = 'CGH' AND p.code = 'DEMO-HMO'
  AND NOT EXISTS (
    SELECT 1 FROM ins.facility_contract AS c
    WHERE c.facility_id = f.id AND c.payer_id = p.id AND c.effective_from = '2024-01-01'
  );

INSERT INTO ins.tariff_schedule (contract_id, version, effective_from)
SELECT c.id, 1, '2024-01-01'
FROM ins.facility_contract AS c
JOIN org.facility AS f ON f.id = c.facility_id
JOIN ins.payer AS p ON p.id = c.payer_id
WHERE f.code = 'CGH' AND p.code = 'DEMO-HMO'
  AND NOT EXISTS (SELECT 1 FROM ins.tariff_schedule AS s WHERE s.contract_id = c.id AND s.version = 1);

INSERT INTO ins.tariff_line (schedule_id, service_code, price)
SELECT s.id, v.code, v.price
FROM ins.tariff_schedule AS s
JOIN ins.facility_contract AS c ON c.id = s.contract_id
JOIN org.facility AS f ON f.id = c.facility_id
JOIN ins.payer AS p ON p.id = c.payer_id,
(VALUES ('CONSULT', 4500), ('BED-DAY', 18000), ('FBC', 3000), ('CT-ABD', 80000)) AS v(code, price)
WHERE f.code = 'CGH' AND p.code = 'DEMO-HMO' AND s.version = 1
  AND NOT EXISTS (SELECT 1 FROM ins.tariff_line AS l WHERE l.schedule_id = s.id AND l.service_code = v.code);

-- Default auto-charge rules (Sprint 22): clinical facts project draft charges.
INSERT INTO rev.billing_rule (event_type, service_code, code_field, quantity)
SELECT v.event_type, v.service_code, v.code_field, 1
FROM (VALUES
  ('lab.ordered', NULL, 'testCode'),
  ('imaging.ordered', NULL, 'procedureCode'),
  ('med.dispensed', NULL, 'medicationCode'),
  ('appointment.booked', 'CONSULT', NULL)
) AS v(event_type, service_code, code_field)
WHERE NOT EXISTS (SELECT 1 FROM rev.billing_rule AS r WHERE r.event_type = v.event_type);
