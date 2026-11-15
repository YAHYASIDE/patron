// Fixture: a normal test file. Mentions in comments do not count: it.only( describe.skip( xit(
import { GadgetsService } from '../../src/modules/gadgets/gadgets.service';

function fit(value: number) {
  return Math.min(value, 10);
}

describe('GadgetsService', () => {
  it('archives a gadget', () => {
    expect(new GadgetsService().archive('g1').archived).toBe(true);
    expect(fit(20)).toBe(10);
    expect('it.only(').toContain('only');
  });
});
