import { registerAs } from '@nestjs/config';

export const awsConfig = registerAs('aws', () => ({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  buckets: {
    cvDocuments: process.env.AWS_S3_BUCKET_CV,
    audioRecordings: process.env.AWS_S3_BUCKET_AUDIO,
    avatars: process.env.AWS_S3_BUCKET_AVATARS || process.env.AWS_S3_BUCKET_CV,
  },
  presignedUrlExpiry: parseInt(process.env.AWS_PRESIGNED_URL_EXPIRY ?? '3600', 10) || 3600, // 1 hour
}));
