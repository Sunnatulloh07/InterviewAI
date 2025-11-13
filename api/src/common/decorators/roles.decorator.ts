import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../enums/user-role.enum';
import { ROLES_KEY } from '../constants/metadata-keys';

/**
 * Decorator to specify required roles for an endpoint
 *
 * @param roles - Array of required roles
 *
 * @example
 * ```typescript
 * @Roles(UserRole.ADMIN, UserRole.ELITE)
 * @Get('admin-only')
 * adminEndpoint() {
 *   return 'Admin only endpoint';
 * }
 * ```
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
