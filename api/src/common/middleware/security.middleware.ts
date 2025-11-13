import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Security Middleware
 * Adds additional security headers beyond Helmet
 * - CSP (Content Security Policy)
 * - Permissions Policy
 * - CORP (Cross-Origin Resource Policy)
 * - COEP (Cross-Origin Embedder Policy)
 */
@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Content Security Policy
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Adjust based on your needs
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://api.openai.com https://openrouter.ai",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );

    // Permissions Policy (formerly Feature Policy)
    res.setHeader(
      'Permissions-Policy',
      [
        'camera=()',
        'microphone=()',
        'geolocation=()',
        'interest-cohort=()', // Disable FLoC
        'payment=()',
        'usb=()',
      ].join(', '),
    );

    // Cross-Origin Resource Policy
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // Cross-Origin Embedder Policy
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    // Cross-Origin Opener Policy
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    // Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // X-Content-Type-Options (prevent MIME sniffing)
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // X-Frame-Options (prevent clickjacking)
    res.setHeader('X-Frame-Options', 'DENY');

    // X-XSS-Protection (legacy, but still useful)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Strict-Transport-Security (HSTS) - Only in production with HTTPS
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // Remove server header to hide technology stack
    res.removeHeader('X-Powered-By');

    next();
  }
}

/**
 * CSRF Protection Middleware
 * Validates CSRF tokens for state-changing operations
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly CSRF_HEADER = 'X-CSRF-Token';
  private readonly CSRF_COOKIE = 'csrf-token';

  use(req: Request, res: Response, next: NextFunction) {
    // Skip CSRF for safe methods
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
      return next();
    }

    // Skip CSRF for API endpoints with Bearer token auth
    if (req.headers.authorization?.startsWith('Bearer ')) {
      return next();
    }

    // Skip CSRF for public endpoints
    if (req.path.startsWith('/api/v1/auth') || req.path.startsWith('/api/v1/health')) {
      return next();
    }

    // Validate CSRF token
    const csrfToken = req.headers[this.CSRF_HEADER.toLowerCase()] || req.cookies?.[this.CSRF_COOKIE];
    const sessionCsrfToken = (req as any).session?.csrfToken;

    if (!csrfToken || csrfToken !== sessionCsrfToken) {
      res.status(403).json({
        statusCode: 403,
        message: 'Invalid CSRF token',
        error: 'Forbidden',
      });
      return;
    }

    next();
  }
}
