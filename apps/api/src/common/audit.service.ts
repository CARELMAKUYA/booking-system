import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** Records who did what. Required for staff accountability and POPIA access logging. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    userId: string | null,
    action: string,
    entity: string,
    entityId?: string | null,
    details?: Prisma.InputJsonValue,
    tx?: Tx,
  ) {
    return (tx ?? this.prisma).auditLog.create({
      data: { userId, action, entity, entityId: entityId ?? null, details },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
