import { SetMetadata } from '@nestjs/common';

export const TRACK_PERFORMANCE_KEY = 'track_performance';

/**
 * Track Performance Decorator
 * Marks methods that should have performance tracking
 * Usage: @TrackPerformance('operation_name')
 */
export const TrackPerformance = (operationName?: string) =>
  SetMetadata(TRACK_PERFORMANCE_KEY, operationName);
