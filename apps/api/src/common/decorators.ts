import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export type AuthedRequest = Request & { user?: AuthUser; sessionId?: string };

export const IS_PUBLIC = 'isPublic';
/** Skips the session guard (login, health check). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restricts a route to the given roles. Routes without it are open to any signed-in user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const OwnerOnly = () => Roles(Role.OWNER);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user!;
});
