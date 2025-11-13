import { SetMetadata } from '@nestjs/common';
import { AuditEventType } from '../logger/winston.config';

export const AUDIT_LOG_KEY = 'audit_log';

/**
 * Audit Log Decorator
 * Marks endpoints that should be audited
 * Usage: @AuditLog(AuditEventType.USER_DELETE)
 */
export const AuditLog = (eventType: AuditEventType) => SetMetadata(AUDIT_LOG_KEY, eventType);
