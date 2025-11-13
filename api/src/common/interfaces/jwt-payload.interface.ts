/**
 * JWT Payload Interface
 * Used for access and refresh tokens
 */
export interface JwtPayload {
  sub: string; // User ID
  email?: string; // Optional - may not be set for phone-only users
  role: string;
  iat?: number; // Issued at
  exp?: number; // Expiration
}

/**
 * User object attached to request after JWT validation
 */
export interface RequestUser {
  id: string;
  email: string;
  role: string;
  refreshToken?: string; // Only for refresh token strategy
}
