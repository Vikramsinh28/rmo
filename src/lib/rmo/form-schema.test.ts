import { parseFormSchema, validateAnswers } from '@/lib/rmo/form-schema';
import { fillSeries } from '@/lib/rmo/series';

const field = {
  id: 'name',
  key: 'crew_name',
  label: 'Crew name',
  type: 'TEXT',
  required: true,
  placeholder: '',
  helpText: '',
  options: [],
  validation: { minLength: 2 },
  displayOrder: 0,
  section: 'General',
};

describe('form schema', () => {
  it('rejects a duplicate key and accepts a valid answer', () => {
    expect(() => parseFormSchema({ fields: [field, { ...field, id: 'other' }] })).toThrow(/more than once/);
    const schema = parseFormSchema({ fields: [field] });
    expect(validateAnswers(schema, { crew_name: 'Asha' })).toEqual({ crew_name: 'Asha' });
    expect(() => validateAnswers(schema, {})).toThrow(/required/);
    expect(() => validateAnswers(schema, { crew_name: 'Asha', extra: 'no' })).toThrow(/Unknown/);
  });

  it('keeps a multi-day trend as a series', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-07T00:00:00.000Z');
    const series = fillSeries(from, to, new Map([['2026-09-03', 2]]));
    expect(series.bucket).toBe('day');
    expect(series.points).toHaveLength(7);
    expect(series.points.map(point => point.count)).toEqual([0, 0, 2, 0, 0, 0, 0]);
  });
});
