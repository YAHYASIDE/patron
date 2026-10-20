import { randomUUID } from 'crypto';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../../src/common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard';
import { MarketsAdminController, MarketsPublicController } from '../../src/modules/markets/markets.controller';
import {
  CreateMarketDto, LinkAccountDto, MarketDecisionDto, UpdateMarketDto, UpsertMethodsDto, UpsertRulesDto,
} from '../../src/modules/markets/dto/markets.dto';

const user = (permissions: string[], roles: string[] = ['admin']) => ({ id: randomUUID(), email: null, roles, permissions });
const source = { url: 'https://example.test/p', title: 'Page', accessedAt: '2026-10-01' };

describe('Markets controllers', () => {
  const svc = {
    publicList: jest.fn().mockResolvedValue([]),
    publicRules: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue([]),
    detail: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    upsertMethods: jest.fn().mockResolvedValue({ created: 1, updated: 0 }),
    upsertRules: jest.fn().mockResolvedValue({ created: 1, updated: 0 }),
    decideMethod: jest.fn().mockResolvedValue({}),
    decideRule: jest.fn().mockResolvedValue({}),
    linkAccount: jest.fn().mockResolvedValue({}),
  };
  const admin = new MarketsAdminController(svc as never);
  const pub = new MarketsPublicController(svc as never);
  const id = randomUUID();

  it('reading needs markets.manage or intelligence.read, enforced by the guard; super_admin always passes', () => {
    // the real guard on the real route metadata, as the global APP_GUARD runs it
    const guard = new PermissionsGuard(new Reflector());
    const canRead = (handler: object, u: unknown) =>
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => ({ user: u }) }),
        getHandler: () => handler,
        getClass: () => MarketsAdminController,
      } as unknown as ExecutionContext);
    for (const handler of [MarketsAdminController.prototype.list, MarketsAdminController.prototype.detail]) {
      expect(canRead(handler, user(['intelligence.read'], ['support']))).toBe(true);
      expect(canRead(handler, user(['markets.manage']))).toBe(true);
      expect(canRead(handler, user([], ['super_admin']))).toBe(true);
      expect(() => canRead(handler, user(['orders.read'], ['support']))).toThrow(ForbiddenException);
      expect(() => canRead(handler, user([], ['customer']))).toThrow(ForbiddenException);
      expect(() => canRead(handler, undefined)).toThrow(ForbiddenException);
    }
  });

  it('passes each call to the service with the acting staff member', async () => {
    await admin.list();
    await admin.detail('ML');
    expect(svc.detail).toHaveBeenCalledWith('ML');
    await admin.create({ code: 'BF' } as never, 'actor');
    expect(svc.create).toHaveBeenCalledWith({ code: 'BF' }, 'actor');
    await admin.update('ML', { enabled: true }, 'actor');
    expect(svc.update).toHaveBeenCalledWith('ML', { enabled: true }, 'actor');
    await admin.upsertMethods('ML', { items: [] }, 'actor');
    expect(svc.upsertMethods).toHaveBeenCalledWith('ML', [], { id: 'actor', label: 'staff' });
    await admin.upsertRules('ML', { items: [] }, 'actor');
    expect(svc.upsertRules).toHaveBeenCalledWith('ML', [], { id: 'actor', label: 'staff' });
    await admin.decideMethod(id, { action: 'approve', note: 'n' }, 'actor');
    expect(svc.decideMethod).toHaveBeenCalledWith(id, 'approve', 'n', 'actor');
    await admin.decideRule(id, { action: 'defer' }, 'actor');
    expect(svc.decideRule).toHaveBeenCalledWith(id, 'defer', undefined, 'actor');
    await admin.linkAccount(id, { accountId: 'acc-1' }, 'actor');
    expect(svc.linkAccount).toHaveBeenCalledWith(id, 'acc-1', 'actor');
    await pub.list();
    await pub.rules('ML');
    expect(svc.publicRules).toHaveBeenCalledWith('ML');
  });

  it('public routes are public, writes need markets.manage', () => {
    const meta = (key: string, fn: object) => Reflect.getMetadata(key, fn);
    expect(meta(IS_PUBLIC_KEY, MarketsPublicController.prototype.list)).toBe(true);
    expect(meta(IS_PUBLIC_KEY, MarketsPublicController.prototype.rules)).toBe(true);
    for (const fn of [
      admin.create, admin.update, admin.upsertMethods, admin.upsertRules, admin.decideMethod, admin.decideRule, admin.linkAccount,
    ]) expect(meta(PERMISSIONS_KEY, fn)).toEqual(['markets.manage']);
    for (const fn of [admin.list, admin.detail]) {
      expect(meta(IS_PUBLIC_KEY, fn)).toBeUndefined();
      expect(meta(ANY_PERMISSIONS_KEY, fn)).toEqual(['markets.manage', 'intelligence.read']);
    }
  });
});

describe('Markets DTOs', () => {
  const ok = async (cls: new () => object, body: object) => expect(await validate(plainToInstance(cls, body))).toHaveLength(0);
  const bad = async (cls: new () => object, body: object) => expect(await validate(plainToInstance(cls, body))).not.toHaveLength(0);

  it('a country', async () => {
    const body = { code: 'bf', nameAr: 'بوركينا', nameFr: 'Burkina', nameEn: 'Burkina', currency: 'xof', currencies: ['usd'], languages: ['FR'], dialCode: '+226' };
    const dto = plainToInstance(CreateMarketDto, body);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ code: 'BF', currency: 'XOF', currencies: ['USD'], languages: ['fr'], dialCode: '226' });
    await bad(CreateMarketDto, { ...body, code: 'BFA' });
    await bad(CreateMarketDto, { ...body, dialCode: 'abc' });
    await ok(UpdateMarketDto, { enabled: true });
    await bad(UpdateMarketDto, { currency: 'EURO' });
  });

  it('research items need a source, a known kind or scope and a confidence 0–100', async () => {
    const m = { key: 'orange-money-ml', name: 'Orange Money', kind: 'mobile', sources: [source], confidence: 90, verifiedBy: 'scout' };
    await ok(UpsertMethodsDto, { items: [m] });
    await bad(UpsertMethodsDto, { items: [] });
    await bad(UpsertMethodsDto, { items: [{ ...m, sources: [] }] });
    await bad(UpsertMethodsDto, { items: [{ ...m, sources: [{ ...source, url: 'not a url' }] }] });
    await bad(UpsertMethodsDto, { items: [{ ...m, kind: 'magic' }] });
    await bad(UpsertMethodsDto, { items: [{ ...m, confidence: 101 }] });
    await bad(UpsertMethodsDto, { items: [{ ...m, key: 'Orange Money' }] });

    const r = { scope: 'brand', ref: 'gc-apple-us', availability: 'REGION_ACCOUNT_REQUIRED', sources: [source], confidence: 70, verifiedBy: 'scout' };
    await ok(UpsertRulesDto, { items: [r] });
    await bad(UpsertRulesDto, { items: [{ ...r, availability: 'MAYBE' }] });
    await bad(UpsertRulesDto, { items: [{ ...r, scope: 'shop' }] });
  });

  it('decisions and links', async () => {
    await ok(MarketDecisionDto, { action: 'approve' });
    await bad(MarketDecisionDto, { action: 'activate' });
    await ok(LinkAccountDto, { accountId: 'acc-1' });
    await bad(LinkAccountDto, { accountId: '' });
  });
});
