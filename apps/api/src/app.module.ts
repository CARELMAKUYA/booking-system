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
import { PrismaModule } from './prisma/prisma.service';
import { ReportsModule } from './reports/reports.module';
import { RoomsModule } from './rooms/rooms.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true };
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
