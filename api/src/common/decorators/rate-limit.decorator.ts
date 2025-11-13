import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_KEY, RATE_LIMIT_WINDOW_KEY } from '../constants/metadata-keys';

export const RateLimit = (limit: number, windowInSeconds: number) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(RATE_LIMIT_KEY, limit)(target, propertyKey, descriptor);
    SetMetadata(RATE_LIMIT_WINDOW_KEY, windowInSeconds)(target, propertyKey, descriptor);
    return descriptor;
  };
};
