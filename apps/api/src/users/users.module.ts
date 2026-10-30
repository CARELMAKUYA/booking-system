import { BadRequestException, Body, ConflictException, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { hashPassword } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, OwnerOnly } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsEmail() email: string;
  @IsEnum(Role) role: Role;
  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters' }) password: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8, { message: 'Password must be at least 8 characters' }) password?: string;
}

const userSelect = { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true };

@OwnerOnly()
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.user.findMany({ select: userSelect, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  @Post()
  async create(@Body() dto: CreateUserDto, @CurrentUser() me: AuthUser) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('A staff member with that email already exists');
    }
    const user = await this.prisma.user.create({
      data: { name: dto.name.trim(), email, role: dto.role, passwordHash: await hashPassword(dto.password) },
      select: userSelect,
    });
    await this.audit.log(me.id, 'CREATE', 'User', user.id, { email, role: dto.role });
    return user;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: AuthUser) {
    if (id === me.id && (dto.active === false || (dto.role && dto.role !== Role.OWNER))) {
      throw new BadRequestException('You cannot deactivate or demote your own account');
    }
    const { password, ...rest } = dto;
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
      select: userSelect,
    });
    // Deactivating or resetting a password signs the user out everywhere.
    if (dto.active === false || password) await this.prisma.session.deleteMany({ where: { userId: id } });
    await this.audit.log(me.id, 'UPDATE', 'User', id, { ...rest, passwordReset: !!password });
    return user;
  }

  @Get('audit-log')
  auditLog() {
    return this.prisma.auditLog.findMany({
      take: 200,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } },
    });
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
