import { Repository } from 'typeorm';

import type { AppConfig } from 'src/config/configuration';

import type { InferenceJob } from '../inference-job.entity';
import { PostgresQueueProvider } from './postgres-queue.provider';

/**
 * Regression tests for the queue's row extraction.
 *
 * These exist because of a real defect: TypeORM returns `[rows, affectedCount]` for an
 * `UPDATE ... RETURNING`, so an empty queue produced `raw[0] === []` — an empty ARRAY, which is
 * not `undefined` and therefore passed the original guard. The worker then "claimed" a job whose
 * every field was `undefined`, and because a TypeORM `where` silently drops undefined conditions,
 * it flipped an unrelated, already-completed inference to `running` on every poll tick.
 */
describe('PostgresQueueProvider.claimNext', () => {
  const config = { queue: { maxAttempts: 3 } } as AppConfig;

  function buildProvider(rawResult: unknown): PostgresQueueProvider {
    const repository = { query: jest.fn().mockResolvedValue(rawResult) } as unknown as Repository<InferenceJob>;
    return new PostgresQueueProvider(repository, config);
  }

  it('returns null when the queue is empty and the driver reports plain rows', async () => {
    await expect(buildProvider([]).claimNext()).resolves.toBeNull();
  });

  it('returns null when the driver wraps rows in a [rows, affected] tuple', async () => {
    await expect(buildProvider([[], 0]).claimNext()).resolves.toBeNull();
  });

  it('returns null for a row without identifiers', async () => {
    await expect(buildProvider([{ attempts: 1 }]).claimNext()).resolves.toBeNull();
  });

  it('returns null when the driver returns something unexpected', async () => {
    await expect(buildProvider(null).claimNext()).resolves.toBeNull();
    await expect(buildProvider(undefined).claimNext()).resolves.toBeNull();
    await expect(buildProvider([[null]]).claimNext()).resolves.toBeNull();
  });

  it('claims a well-formed job from plain rows', async () => {
    const provider = buildProvider([
      {
        id: 'job-1',
        case_id: 'case-1',
        image_id: 'image-1',
        requested_by: 'user-1',
        attempts: 1,
        max_attempts: 3,
      },
    ]);

    await expect(provider.claimNext()).resolves.toEqual({
      jobId: 'job-1',
      caseId: 'case-1',
      imageId: 'image-1',
      requestedBy: 'user-1',
      attempts: 1,
      maxAttempts: 3,
    });
  });

  it('claims a well-formed job from a [rows, affected] tuple', async () => {
    const provider = buildProvider([
      [
        {
          id: 'job-2',
          case_id: 'case-2',
          image_id: 'image-2',
          requested_by: 'user-2',
          attempts: 2,
          max_attempts: 3,
        },
      ],
      1,
    ]);

    const claimed = await provider.claimNext();
    expect(claimed?.jobId).toBe('job-2');
    expect(claimed?.caseId).toBe('case-2');
  });
});
