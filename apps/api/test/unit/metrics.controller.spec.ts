import { UnauthorizedException } from '@nestjs/common';
import { MetricsController } from '../../src/common/metrics/metrics.controller';

describe('MetricsController', () => {
  const SCRAPE = '# HELP patron_orders_created_total\n';
  let metrics: any;
  let config: any;
  let controller: MetricsController;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    metrics = { scrape: jest.fn().mockResolvedValue(SCRAPE) };
    config = { get: jest.fn().mockReturnValue(undefined) };
    controller = new MetricsController(metrics, config);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('with a configured token', () => {
    beforeEach(() => config.get.mockReturnValue('s3cret'));

    it('serves metrics when the bearer token matches', async () => {
      await expect(controller.scrape('Bearer s3cret')).resolves.toBe(SCRAPE);
      expect(metrics.scrape).toHaveBeenCalled();
    });

    it('rejects a mismatched token', async () => {
      await expect(controller.scrape('Bearer wrong')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(metrics.scrape).not.toHaveBeenCalled();
    });

    it('rejects a missing Authorization header', async () => {
      await expect(controller.scrape(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('with no configured token', () => {
    beforeEach(() => config.get.mockReturnValue(undefined));

    it('fails closed in production', async () => {
      process.env.NODE_ENV = 'production';
      await expect(controller.scrape('Bearer anything')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(metrics.scrape).not.toHaveBeenCalled();
    });

    it('leaves the endpoint open outside production for local scraping', async () => {
      process.env.NODE_ENV = 'development';
      await expect(controller.scrape(undefined)).resolves.toBe(SCRAPE);
    });
  });

  it('reads the token from the observability config key', async () => {
    await controller.scrape(undefined).catch(() => undefined);
    expect(config.get).toHaveBeenCalledWith('observability.metricsToken');
  });
});
