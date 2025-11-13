/**
 * User Roles Enum
 * Used for role-based access control (RBAC)
 */
export enum UserRole {
  USER = 'user', // Free plan users
  PRO = 'pro', // Pro plan subscribers
  ELITE = 'elite', // Elite plan subscribers
  ADMIN = 'admin', // System administrators
}

/**
 * Role hierarchy for permission checks
 * Higher number = more permissions
 */
export const RoleHierarchy: Record<UserRole, number> = {
  [UserRole.USER]: 1,
  [UserRole.PRO]: 2,
  [UserRole.ELITE]: 3,
  [UserRole.ADMIN]: 4,
};
