-- Legacy entries are deliberately unclassified, rather than assumed confirmed.
ALTER TABLE clin.entry ADD COLUMN verification_status text
  CHECK (verification_status IN ('provisional','confirmed','differential'));
