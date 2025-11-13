import { IsString, IsNotEmpty, IsEnum, IsNumber, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@common/enums/user-role.enum';

export class CreateUserDto {
  @ApiProperty({
    description: 'Phone number in international format (e.g., +998901234567)',
    example: '+998901234567',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{9,14}$/, {
    message: 'Phone number must be in international format',
  })
  phoneNumber: string;

  @ApiProperty({
    description: 'Telegram user ID',
    example: 123456789,
  })
  @IsNumber()
  @IsNotEmpty()
  telegramId: number;

  @ApiPropertyOptional({
    description: 'Telegram username',
    example: 'john_doe',
  })
  @IsString()
  @IsOptional()
  telegramUsername?: string;

  @ApiPropertyOptional({
    description: 'Telegram first name',
    example: 'John',
  })
  @IsString()
  @IsOptional()
  telegramFirstName?: string;

  @ApiPropertyOptional({
    description: 'Telegram last name',
    example: 'Doe',
  })
  @IsString()
  @IsOptional()
  telegramLastName?: string;

  @ApiProperty({
    description: 'User first name',
    example: 'John',
  })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
  })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({
    description: 'User language preference (ISO 639-1)',
    example: 'uz',
    default: 'uz',
  })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({
    description: 'User role',
    example: UserRole.USER,
    enum: UserRole,
    default: UserRole.USER,
  })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}
