import { PipeTransform, Injectable, BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Pipe to validate and transform MongoDB ObjectId
 * Throws BadRequestException if invalid
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, Types.ObjectId> {
  transform(value: string, metadata: ArgumentMetadata): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ObjectId format for parameter "${metadata.data}"`);
    }

    return new Types.ObjectId(value);
  }
}
