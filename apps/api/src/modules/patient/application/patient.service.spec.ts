import { PatientService } from './patient.service.js';
import type { PatientRepository } from '../domain/patient.repository.js';
import { scoreDuplicates } from '../domain/patient.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('scoreDuplicates', () => {
  it('flags exact identifier match as CONFIRMED', () => {
    const out = scoreDuplicates(
      { familyName: 'Doe', dateOfBirth: '1990-01-01' },
      [
        {
          patientId: 'p1',
          familyName: 'Other',
          dateOfBirth: '1980-05-05',
          identifiers: [{ system: 'urn:x', value: 'ABC123' }],
        },
      ],
      [{ system: 'urn:y', value: 'ABC123' }],
    );
    expect(out).toEqual([
      { patientId: 'p1', risk: 'CONFIRMED', reasons: ['identifier-match'] },
    ]);
  });

  it('flags surname+dob as REVIEW, ignores others', () => {
    const out = scoreDuplicates(
      { familyName: '  DOE ', dateOfBirth: '1990-01-01' },
      [
        {
          patientId: 'p1',
          familyName: 'doe',
          dateOfBirth: '1990-01-01',
          identifiers: [],
        },
        {
          patientId: 'p2',
          familyName: 'Smith',
          dateOfBirth: '1990-01-01',
          identifiers: [],
        },
      ],
      [],
    );
    expect(out).toEqual([
      { patientId: 'p1', risk: 'REVIEW', reasons: ['surname-dob-match'] },
    ]);
  });
});

describe('PatientService (unit, fake repo)', () => {
  function fakeRepo(): PatientRepository & { calls: { created: number } } {
    const calls = { created: 0 };
    const repo: PatientRepository & { calls: { created: number } } = {
      calls,
      create: async (input) => {
        calls.created += 1;
        return {
          id: '11111111-1111-1111-1111-111111111111',
          familyName: input.familyName,
          givenName: input.givenName,
          dateOfBirth: input.dateOfBirth,
          sex: input.sex,
          facilityId: input.facilityId,
          status: 'active',
        };
      },
      findById: async () => undefined,
      search: async () => [],
      listFacilityPatients: async () => [],
      merge: async () => undefined,
      findMergeTarget: async () => undefined,
      setGuarantor: async () => undefined,
      findByIdentifierValue: async () => [],
    };
    return repo;
  }

  it('registers when no duplicates, returns REVIEW candidates without blocking', async () => {
    const repo = fakeRepo();
    const svc = new PatientService(repo, new OutboxService(undefined));
    const res = await svc.register({
      familyName: 'Doe',
      givenName: 'Jane',
      dateOfBirth: '1990-01-01',
      sex: 'F',
      facilityId: 'f1',
      mrn: 'M1',
    });
    expect(res.patient.id).toBeDefined();
    expect(res.duplicates).toEqual([]);
    expect(repo.calls.created).toBe(1);
  });

  it('blocks registration on CONFIRMED identifier clash', async () => {
    const repo = fakeRepo();
    repo.listFacilityPatients = async () => [
      {
        patientId: 'p9',
        familyName: 'Other',
        dateOfBirth: '1980-01-01',
        identifiers: [{ system: 'urn:pulse:mrn:f1', value: 'M1' }],
      },
    ];
    const svc = new PatientService(repo, new OutboxService(undefined));
    await expect(
      svc.register({
        familyName: 'New',
        givenName: 'Person',
        dateOfBirth: '2000-02-02',
        sex: 'M',
        facilityId: 'f1',
        mrn: 'M1',
      }),
    ).rejects.toThrow('Exact identifier match');
    expect(repo.calls.created).toBe(0);
  });

  it('rejects self-merge', async () => {
    const svc = new PatientService(fakeRepo(), new OutboxService(undefined));
    await expect(
      svc.merge({ survivorId: 'a', duplicateId: 'a', reason: 'test reason here' }),
    ).rejects.toThrow('must differ');
  });
});
