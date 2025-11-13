/**
 * Payment status
 */
export enum PaymentStatus {
  SUCCEEDED = 'succeeded',
  PENDING = 'pending',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

/**
 * Notification status
 */
export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  READ = 'read',
}
