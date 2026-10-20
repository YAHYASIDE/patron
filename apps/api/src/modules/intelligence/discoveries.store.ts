import { Injectable, Logger } from '@nestjs/common';
import { Discovery, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { scrubDeep, scrubText } from './scrubber';
import { CLOSED, DiscoveryInput } from './intelligence.types';

export type UpsertOutcome = { discovery: Discovery; created: boolean };

/** The staff notice for a critical discovery: one per discovery, closed when it is done or rejected. */
export const criticalKey = (id: string) => `intel.critical:${id}`;

/**
 * Discoveries, one row per subject (fingerprint). Seeing a subject again never
 * adds a row and never overrides a person's decision:
 *
 * - the status stays as it is (a DONE or REJECTED one is not reopened: its
 *   `testResults.reappeared` is set and a person decides);
 * - a DEFERRED one stays deferred until `deferredUntil`; seen after that it
 *   goes back to PENDING_REVIEW;
 * - `seenCount` goes up by one, `lastSeenAt` moves, and the newer facts and
 *   evidence replace the old ones.
 *
 * Everything is scrubbed before it is stored. A CRITICAL discovery that is open
 * (new, or newly CRITICAL) raises the owner's `intel.critical` notice.
 */
@Injectable()
export class DiscoveriesStore {
  private readonly log = new Logger(DiscoveriesStore.name);

  constructor(
    private prisma: PrismaService,
    private staff: StaffNotificationsService,
  ) {}

  async upsert(input: DiscoveryInput, source: string, now = new Date()): Promise<UpsertOutcome> {
    const clean = this.clean(input);
    const existing = await this.prisma.discovery.findUnique({ where: { fingerprint: clean.fingerprint }, select: { id: true } });
    if (existing) return this.seenAgain(existing.id, clean, now);

    // INSERT … ON CONFLICT DO NOTHING: when two writers see a new subject at
    // once, one inserts and the other finds nothing inserted and takes the
    // update path, so the sighting is still counted and nothing errors.
    const { count } = await this.prisma.discovery.createMany({
      data: [{
        ...clean,
        evidence: clean.evidence as unknown as Prisma.InputJsonValue,
        testResults: clean.testResults ? (clean.testResults as Prisma.InputJsonValue) : Prisma.JsonNull,
        source: scrubText(source),
        status: 'NEW',
        seenCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      }],
      skipDuplicates: true,
    });
    const discovery = await this.prisma.discovery.findUniqueOrThrow({ where: { fingerprint: clean.fingerprint } });
    if (!count) return this.seenAgain(discovery.id, clean, now);
    if (discovery.severity === 'CRITICAL') await this.raiseCritical(discovery);
    return { discovery, created: true };
  }

  /** The update path, under a row lock so two sightings at once count twice and decide from the same state. */
  private async seenAgain(id: string, clean: DiscoveryInput, now: Date): Promise<UpsertOutcome> {
    const { discovery, notify } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "discoveries" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const before = await tx.discovery.findUniqueOrThrow({ where: { id } });
      const closed = CLOSED.includes(before.status);
      const deferredOver = before.status === 'DEFERRED' && (!before.deferredUntil || before.deferredUntil <= now);
      const status = deferredOver ? 'PENDING_REVIEW' : before.status;

      const previous = (before.testResults && typeof before.testResults === 'object' && !Array.isArray(before.testResults))
        ? (before.testResults as Record<string, unknown>)
        : {};
      const testResults = closed
        ? { ...previous, ...(clean.testResults ?? {}), reappeared: true, reappearedAt: now.toISOString() }
        : clean.testResults;

      const updated = await tx.discovery.update({
        where: { id },
        data: {
          title: clean.title,
          description: clean.description,
          evidence: clean.evidence as unknown as Prisma.InputJsonValue,
          confidence: clean.confidence,
          verified: clean.verified,
          severity: clean.severity,
          impact: clean.impact,
          proposal: clean.proposal,
          ...(testResults !== undefined && { testResults: testResults as Prisma.InputJsonValue }),
          ...(clean.branch !== undefined && { branch: clean.branch }),
          ...(clean.prUrl !== undefined && { prUrl: clean.prUrl }),
          status,
          ...(deferredOver && { deferredUntil: null }),
          seenCount: { increment: 1 },
          lastSeenAt: now,
        },
      });
      // open and critical, and it was not before (newly critical, or back from a deferral)
      const open = !closed && updated.status !== 'DEFERRED';
      const wasLoud = before.severity === 'CRITICAL' && !CLOSED.includes(before.status) && before.status !== 'DEFERRED';
      return { discovery: updated, notify: open && updated.severity === 'CRITICAL' && !wasLoud };
    });
    if (notify) await this.raiseCritical(discovery);
    return { discovery, created: false };
  }

  /** The owner's notice (Arabic). Never throws: StaffNotificationsService swallows its own errors. */
  async raiseCritical(d: Pick<Discovery, 'id' | 'title' | 'impact' | 'proposal'>) {
    await this.staff.notify({
      type: 'intel.critical',
      priority: 'URGENT',
      title: `اكتشاف حرج: ${d.title}`.slice(0, 200),
      body: `الأثر: ${d.impact}\nالمقترح: ${d.proposal}`.slice(0, 500),
      link: `/intelligence?d=${d.id}`,
      dedupeKey: criticalKey(d.id),
      entityType: 'Discovery',
      entityId: d.id,
    });
  }

  async resolveCritical(id: string, tx?: Prisma.TransactionClient) {
    try {
      await this.staff.resolve(criticalKey(id), tx);
    } catch (e) {
      this.log.warn(`intel.critical ${id} not resolved: ${e instanceof Error ? e.message : e}`);
    }
  }

  private clean(input: DiscoveryInput): DiscoveryInput {
    return {
      fingerprint: input.fingerprint,
      kind: input.kind,
      title: scrubText(input.title),
      description: scrubText(input.description),
      evidence: scrubDeep(input.evidence ?? []),
      confidence: Math.max(0, Math.min(100, Math.round(input.confidence))),
      verified: input.verified,
      severity: input.severity,
      impact: scrubText(input.impact),
      proposal: scrubText(input.proposal),
      ...(input.testResults !== undefined && { testResults: scrubDeep(input.testResults) }),
      ...(input.branch !== undefined && { branch: input.branch }),
      ...(input.prUrl !== undefined && { prUrl: input.prUrl }),
    };
  }
}
