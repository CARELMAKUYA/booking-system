import { Body, Controller, Get, Injectable, Module, Put } from '@nestjs/common';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, OwnerOnly } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(120) businessName?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() email?: string | null;
  @IsOptional() @IsBoolean() vatRegistered?: boolean;
  @IsOptional() @IsString() @MaxLength(20) vatNumber?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(5000) vatRateBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) defaultDepositPercent?: number;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) checkInTime?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) checkOutTime?: string;
  @IsOptional() @IsString() @MaxLength(1000) bankDetails?: string | null;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get() {
    return this.prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }
}

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @OwnerOnly()
  @Put()
  async update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthUser) {
    const data = { ...dto, email: dto.email || null };
    const saved = await this.prisma.settings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await this.audit.log(user.id, 'UPDATE', 'Settings', '1', dto as object);
    return saved;
  }
}

@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
