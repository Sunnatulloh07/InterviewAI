import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class AuthResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT access token',
  })
  accessToken: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT refresh token',
  })
  refreshToken: string;

  @ApiProperty({
    type: UserResponseDto,
    description: 'User profile information',
  })
  user: UserResponseDto;

  @ApiProperty({
    example: 900,
    description: 'Token expiration time in seconds',
  })
  expiresIn: number;
}

export class RegisterResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Registration successful. Please verify your email.' })
  message: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  userId: string;

  @ApiProperty({ example: true })
  verificationSent: boolean;
}
