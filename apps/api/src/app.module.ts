import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionGuard } from './auth/session.guard';
import { BookingsModule } from './bookings/bookings.controller';
import { AuditModule } from './common/audit.service';
import { Public } from './common/decorators';
import { GuestsModule } from './guests/guests.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { ReportsModule } from './reports/reports.module';
import { RoomsModule } from './rooms/rooms.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Reports database reachability without revealing connection details. */
  @Public()
  @Get()
  async health() {
    if (!process.env.DATABASE_URL) return { ok: false, database: 'DATABASE_URL is not set' };
    if (/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL) && process.env.VERCEL) {
      return { ok: false, database: 'DATABASE_URL points to localhost, which does not exist on Vercel' };
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const users = await this.prisma.user.count();
      return { ok: true, database: users ? 'connected' : 'connected, but no users yet (run migrations and the seed)' };
    } catch (err) {
      const code = (err as { code?: string }).code;
      const tablesMissing = code === 'P2021' || /does not exist/.test(String(err));
      return { ok: false, database: tablesMissing ? 'connected, but tables are missing (run prisma migrate deploy)' : `unreachable${code ? ` (${code})` : ''}` };
    }
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    SettingsModule,
    UsersModule,
    RoomsModule,
    GuestsModule,
    BookingsModule,
    PaymentsModule,
    ReportsModule,
  ],
  controllers: [AuthController, HealthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
