import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { AdminRequestKind, Prisma, SafetyModeKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SafetyModeService, SYSTEM_USER_ID } from '../safety/safety-mode.service';
import { ExitGateService } from '../safety/exit-gate.service';
import { POLICY } from '../safety/policy-version';
import { RequestGateService } from './request-gate';
import type { Capability } from '../safety/capability-matrix';

/** Which actions require two distinct operators. */
const DUAL_CONTROL: Record<AdminRequestKind, boolean> = {
  enter_mode: false,
  exit_mode: false,
  pause_provider: false,
  resume_provider: false,
  pause_queue: false,
  resume_queue: false,
  reduce_concurrency: false,
  drain_releases: true,
  force_unlock_release: true,
};

/** Capability required to CREATE the request (matrix-enforced). */
const CAPABILITY_FOR: Record<AdminRequestKind, Capability> = {
  enter_mode: 'admin.pause_provider',
  exit_mode: 'admin.exit_protective_mode',
  pause_provider: 'admin.pause_provider',
  resume_provider: 'admin.resume_provider',
  pause_queue: 'admin.pause_provider',
  resume_queue: 'admin.resume_provider',
  reduce_concurrency: 'admin.pause_provider',
  drain_releases: 'admin.drain_releases',
  force_unlock_release: 'admin.force_unlock_release',
};

function requiresDualControl(kind: AdminRequestKind, params: any): boolean {
  if (DUAL_CONTROL[kind]) return true;
  if (kind === 'exit_mode') {
    const target = params?.toMode as SafetyModeKind | undefined;
    const from = params?.fromMode as SafetyModeKind | undefined;
    return target === 'normal' && (from === 'audit_compromised' || from === 'emergency_freeze');
  }
  return false;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly safety: SafetyModeService,
    private readonly exitGate: ExitGateService,
    private readonly reqGate: RequestGateService,
  ) {}

  async request(
    requestedBy: string,
    kind: AdminRequestKind,
    params: any,
    reason: string,
    ttlMinutes = 30,
  ) {
    await this.safety.assert(CAPABILITY_FOR[kind]);

    const snap = await this.reqGate.snapshot();
    const req = await this.prisma.adminRequest.create({
      data: {
        kind,
        params: params as Prisma.InputJsonValue,
        requestedBy,
        reason,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        stateHash: snap.hash,
        policyVersion: POLICY.version,
        approvalNonce: crypto.randomBytes(16).toString('hex'),
      },
    });
    await this.audit.record({
      userId: SYSTEM_USER_ID,
      actor: 'admin',
      eventType: 'admin.request.created',
      payload: {
        id: req.id, kind, params, requestedBy,
        dual: requiresDualControl(kind, params),
        reason, stateHash: snap.hash, policyVersion: POLICY.version,
      },
    });

    if (!requiresDualControl(kind, params)) {
      return this.approveAndExecute(req.id, requestedBy);
    }
    return { status: 'pending', id: req.id, dual: true, stateHash: snap.hash };
  }

  async approveAndExecute(requestId: string, approver: string) {
    const req = await this.prisma.adminRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException();
    if (req.status !== 'pending') throw new ConflictException(`request is ${req.status}`);
    if (req.expiresAt <= new Date()) {
      await this.prisma.adminRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: { status: 'expired' },
      });
      throw new ConflictException('request expired');
    }
    const dual = requiresDualControl(req.kind, req.params);
    if (dual && req.requestedBy === approver) {
      throw new ForbiddenException('dual-control: approver must differ from requester');
    }

    // State-hash + policy-version gates.
    const snap = await this.reqGate.snapshot();
    if (snap.hash !== req.stateHash) {
      throw new ConflictException('system state changed since request was created; resubmit');
    }
    if (POLICY.version !== req.policyVersion) {
      throw new ConflictException('policy version changed since request was created; resubmit');
    }

    // Exit gate for exit_mode → normal.
    if (req.kind === 'exit_mode') {
      const target = (req.params as any).toMode as SafetyModeKind | undefined;
      if (target === 'normal') {
        const current = await this.safety.current();
        const report = await this.exitGate.evaluate(current.mode, target);
        const force = (req.params as any).force === true;
        if (!report.safe && !force) {
          throw new ConflictException(`exit gate: ${report.blockers.join('; ')}`);
        }
        if (force && !report.safe) {
          await this.audit.record({
            userId: SYSTEM_USER_ID,
            actor: 'admin',
            eventType: 'admin.exit.forced_override',
            payload: { blockers: report.blockers, requestId, approver },
          });
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const approved = await tx.adminRequest.updateMany({
        where: {
          id: requestId,
          status: 'pending',
          approvalNonce: req.approvalNonce, // nonce burn — prevents replay
        },
        data: { status: 'approved', approvedBy: approver, approvedAt: new Date() },
      });
      if (approved.count !== 1) throw new ConflictException('race on approval');

      await this.executeInTx(tx, req.kind as AdminRequestKind, req.params, approver);

      await tx.adminRequest.update({
        where: { id: requestId },
        data: { status: 'executed', executedAt: new Date() },
      });
      await this.audit.record({
        userId: SYSTEM_USER_ID,
        actor: 'admin',
        eventType: 'admin.request.executed',
        payload: {
          id: requestId, kind: req.kind, requestedBy: req.requestedBy,
          approvedBy: approver, stateHash: req.stateHash,
          policyVersion: req.policyVersion,
        },
      });
      return { status: 'executed', id: requestId };
    });
  }

  async reject(requestId: string, rejecter: string, reason: string) {
    await this.prisma.adminRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status: 'rejected', rejectedBy: rejecter, rejectedAt: new Date() },
    });
    await this.audit.record({
      userId: SYSTEM_USER_ID,
      actor: 'admin',
      eventType: 'admin.request.rejected',
      payload: { id: requestId, rejecter, reason },
    });
  }

  private async executeInTx(
    tx: any,
    kind: AdminRequestKind,
    params: any,
    approvedBy: string,
  ) {
    switch (kind) {
      case 'enter_mode':
        await this.safety.enter(params.toMode, `admin: ${params.reason ?? 'n/a'}`, approvedBy, { auto: false });
        return;
      case 'exit_mode':
        await this.safety.enter('normal', `admin: ${params.reason ?? 'n/a'}`, approvedBy, { auto: false });
        return;
      case 'pause_provider':
        await this.safety.isolateProvider(params.provider, `admin: ${params.reason}`, approvedBy);
        return;
      case 'resume_provider':
        await this.safety.unisolateProvider(params.provider, approvedBy);
        return;
      case 'pause_queue':
        await tx.safetyMode.update({
          where: { id: 'global' },
          data: { notes: `paused:${params.queue}@${new Date().toISOString()}` },
        });
        return;
      case 'resume_queue':
        await tx.safetyMode.update({ where: { id: 'global' }, data: { notes: null } });
        return;
      case 'reduce_concurrency':
        await tx.safetyMode.update({
          where: { id: 'global' },
          data: { notes: `release_batch_size:${params.concurrency}` },
        });
        return;
      case 'drain_releases':
        await tx.releaseAction.updateMany({
          where: { state: { in: ['pending', 'failed_temporary'] } },
          data: { state: 'aborted', lastError: 'admin drain_releases' },
        });
        await tx.release.updateMany({
          where: { state: { in: ['pending', 'executing'] } },
          data: {
            state: 'aborted',
            canceledAt: new Date(),
            canceledBy: approvedBy,
            cancelReason: 'drain_releases',
          },
        });
        return;
      case 'force_unlock_release':
        await tx.release.updateMany({
          where: { id: params.releaseId, canceledAt: { not: null } },
          data: { state: 'executing', canceledAt: null, canceledBy: null, cancelReason: null },
        });
        return;
    }
  }
}
