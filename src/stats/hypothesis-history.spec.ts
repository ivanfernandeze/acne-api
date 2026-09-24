import type { Repository } from 'typeorm';

import type { AppConfig } from 'src/config/configuration';
import type { IndicatorsService } from 'src/indicators/indicators.service';

import type { AiEngineClient } from 'src/inference/ai-engine.client';

import { HypothesisRun } from './hypothesis-run.entity';
import { StatsService } from './stats.service';

/**
 * The history of contrasts must come back WITH its pairs.
 *
 * Regression test for a defect the type checker could not see and no unit test could reach: when
 * `hypothesis_runs.pairs` stopped being a `jsonb` column and became rows of `pares_hipotesis`, the
 * history query kept loading only the header. Every field of the DTO looked right — test applied,
 * p-value, effect size — and `pairs` came back empty, so a contrast rendered as valid but without
 * the data that makes it re-executable, which is precisely what RNF-05 requires the system to be
 * able to show an external evaluator. It only surfaced by running the whole stack.
 *
 * Two assertions, because either one alone would still pass with the bug present: that the query
 * asks for the relation, and that a loaded run reaches the DTO with its pairs intact.
 */
describe('StatsService.history', () => {
  function build(runs: HypothesisRun[]): { service: StatsService; find: jest.Mock } {
    const find = jest.fn().mockResolvedValue(runs);
    const repository = { find } as unknown as Repository<HypothesisRun>;

    const service = new StatsService(
      repository,
      {} as IndicatorsService,
      {} as AiEngineClient,
      { stats: { alpha: 0.05 } } as unknown as AppConfig,
    );
    return { service, find };
  }

  function runWithPairs(): HypothesisRun {
    const run = new HypothesisRun();
    Object.assign(run, {
      id: 'run-1',
      hypothesis: 'HE1',
      indicator: 'TRM',
      design: 'paired',
      alpha: 0.05,
      alternative: 'less',
      nPairs: 2,
      pretestMean: 10,
      postestMean: 6,
      meanDifference: -4,
      normalityTest: 'shapiro-wilk',
      normalityStatistic: 0.97,
      normalityPValue: 0.6,
      normalityNormal: true,
      normalityApplicable: true,
      normalityNote: null,
      testApplied: 'ttest_rel',
      statistic: -7.1,
      pValue: 0.0001,
      effectKind: 'cohens_dz',
      effectValue: -1.42,
      effectMagnitude: 'large',
      rejectsNull: true,
      conclusion: 'Se rechaza H₀.',
      seed: 42,
      functionVersion: 'acne-stats/1.0.0',
      inputHash: 'abc',
      includesSynthetic: true,
      executedBy: null,
      executedAt: new Date('2026-09-05T00:00:00Z'),
      pairRows: [
        {
          runId: 'run-1',
          pairKey: 'caso-1',
          label: 'ACN-2026-0001',
          pretest: 12,
          postest: 7,
          difference: -5,
        },
        {
          runId: 'run-1',
          pairKey: 'caso-2',
          label: 'ACN-2026-0002',
          pretest: 8,
          postest: 5,
          difference: -3,
        },
      ],
    });
    return run;
  }

  it('pide la relación de pares al consultar el historial', async () => {
    const { service, find } = build([]);

    await service.history('HE1');

    const options = find.mock.calls[0]?.[0] as { relations?: { pairRows?: boolean } };
    expect(options.relations?.pairRows).toBe(true);
  });

  it('devuelve los pares y la normalidad rearmados desde sus columnas y filas', async () => {
    const { service } = build([runWithPairs()]);

    const [result] = await service.history('HE1');

    expect(result?.pairs).toHaveLength(2);
    expect(result?.pairs[0]).toEqual({
      pairKey: 'caso-1',
      label: 'ACN-2026-0001',
      pretest: 12,
      postest: 7,
      difference: -5,
    });
    // El bloque de normalidad y el tamaño de efecto también dejaron de ser jsonb.
    expect(result?.normality).toMatchObject({ test: 'shapiro-wilk', normal: true, applicable: true });
    expect(result?.effectSize).toEqual({ kind: 'cohens_dz', value: -1.42, magnitude: 'large' });
  });
});
