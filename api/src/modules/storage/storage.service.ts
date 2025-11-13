import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';

const mkdir = util.promisify(fs.mkdir);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);
const access = util.promisify(fs.access);

type StorageMode = 'local' | 's3';
type BucketType = 'cv' | 'audio' | 'avatar';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageMode: StorageMode;
  private readonly localUploadPath: string;
  private readonly publicUrl: string;

  // S3 properties (only initialized if S3 mode)
  private s3Client: S3Client | null = null;
  private readonly cvBucket: string;
  private readonly audioBucket: string;
  private readonly avatarsBucket: string;
  private readonly region: string;
  private readonly presignedUrlExpiry: number;

  constructor(private readonly configService: ConfigService) {
    // Determine storage mode based on AWS credentials availability
    const hasAwsCredentials =
      this.configService.get<string>('AWS_ACCESS_KEY_ID') &&
      this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    this.storageMode = hasAwsCredentials ? 's3' : 'local';

    // Local storage configuration
    this.localUploadPath = this.configService.get<string>('LOCAL_UPLOAD_PATH', './uploads');
    this.publicUrl = this.configService.get<string>('PUBLIC_URL', 'http://localhost:3000');

    // S3 configuration (loaded even in local mode for fallback)
    this.region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    this.cvBucket = this.configService.get<string>('AWS_S3_BUCKET_CV', 'interviewai-cv-documents');
    this.audioBucket = this.configService.get<string>(
      'AWS_S3_BUCKET_AUDIO',
      'interviewai-audio-recordings',
    );
    this.avatarsBucket = this.configService.get<string>(
      'AWS_S3_BUCKET_AVATARS',
      'interviewai-avatars',
    );
    this.presignedUrlExpiry = this.configService.get<number>('AWS_PRESIGNED_URL_EXPIRY', 3600);

    // Initialize S3 client if in S3 mode
    if (this.storageMode === 's3') {
      this.s3Client = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
          secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
        },
      });
      this.logger.log(`Storage service initialized in S3 mode (region: ${this.region})`);
    } else {
      this.logger.log(`Storage service initialized in LOCAL mode (path: ${this.localUploadPath})`);
      this.ensureUploadDirectories();
    }
  }

  /**
   * Ensure upload directories exist (for local storage)
   */
  private async ensureUploadDirectories(): Promise<void> {
    try {
      const dirs = [
        path.join(this.localUploadPath, 'cvs'),
        path.join(this.localUploadPath, 'audio'),
        path.join(this.localUploadPath, 'avatars'),
      ];

      for (const dir of dirs) {
        try {
          await access(dir);
        } catch {
          await mkdir(dir, { recursive: true });
          this.logger.log(`Created upload directory: ${dir}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to create upload directories: ${error.message}`, error.stack);
    }
  }

  /**
   * Upload CV file (supports both local and S3)
   */
  async uploadCv(
    file: Express.Multer.File,
    userId: string,
  ): Promise<{ storageUrl: string; key: string }> {
    try {
      const fileExt = path.extname(file.originalname);
      const fileName = `${userId}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${fileExt}`;
      const key = `cvs/${fileName}`;

      if (this.storageMode === 's3') {
        return await this.uploadToS3('cv', key, file, { userId, originalName: file.originalname });
      } else {
        return await this.uploadToLocal('cv', key, file);
      }
    } catch (error) {
      this.logger.error(`Failed to upload CV: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to upload file to storage');
    }
  }

  /**
   * Upload audio file (supports both local and S3)
   */
  async uploadAudio(
    file: Express.Multer.File,
    userId: string,
    sessionId: string,
  ): Promise<{ storageUrl: string; key: string }> {
    try {
      const fileExt = path.extname(file.originalname);
      const fileName = `${userId}/${sessionId}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${fileExt}`;
      const key = `audio/${fileName}`;

      if (this.storageMode === 's3') {
        return await this.uploadToS3('audio', key, file, {
          userId,
          sessionId,
          originalName: file.originalname,
        });
      } else {
        return await this.uploadToLocal('audio', key, file);
      }
    } catch (error) {
      this.logger.error(`Failed to upload audio: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to upload audio to storage');
    }
  }

  /**
   * Upload avatar/profile picture (supports both local and S3)
   */
  async uploadAvatar(
    file: Express.Multer.File,
    userId: string,
  ): Promise<{ storageUrl: string; key: string }> {
    try {
      // Validate file type (only images)
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new BadRequestException('Invalid file type. Only images are allowed.');
      }

      const fileExt = path.extname(file.originalname);
      const fileName = `${userId}-${Date.now()}${fileExt}`;
      const key = `avatars/${fileName}`;

      if (this.storageMode === 's3') {
        return await this.uploadToS3('avatar', key, file, { userId }, 'max-age=31536000');
      } else {
        return await this.uploadToLocal('avatar', key, file);
      }
    } catch (error) {
      this.logger.error(`Failed to upload avatar: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to upload avatar to storage');
    }
  }

  /**
   * Delete file (supports both local and S3)
   */
  async deleteFile(bucket: BucketType, key: string): Promise<void> {
    try {
      if (this.storageMode === 's3') {
        await this.deleteFromS3(bucket, key);
      } else {
        await this.deleteFromLocal(key);
      }
      this.logger.log(`File deleted successfully: ${key} from ${bucket}`);
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error.message}`, error.stack);
      // Don't throw error for delete operations
    }
  }

  /**
   * Generate presigned URL for file access (S3 only, returns direct URL for local)
   */
  async getPresignedUrl(bucket: BucketType, key: string, expiresIn?: number): Promise<string> {
    try {
      if (this.storageMode === 's3' && this.s3Client) {
        const bucketName = this.getBucketName(bucket);
        const command = new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        });

        const url = await getSignedUrl(this.s3Client, command, {
          expiresIn: expiresIn || this.presignedUrlExpiry,
        });

        this.logger.debug(`Generated presigned URL for: ${key}`);
        return url;
      } else {
        // For local storage, return direct URL
        return `${this.publicUrl}/uploads/${key}`;
      }
    } catch (error) {
      this.logger.error(`Failed to generate presigned URL: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to generate file access URL');
    }
  }

  /**
   * Upload to S3 (internal method)
   */
  private async uploadToS3(
    bucket: BucketType,
    key: string,
    file: Express.Multer.File,
    metadata: Record<string, string>,
    cacheControl?: string,
  ): Promise<{ storageUrl: string; key: string }> {
    if (!this.s3Client) {
      throw new BadRequestException('S3 client not initialized');
    }

    const bucketName = this.getBucketName(bucket);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: cacheControl,
      Metadata: {
        ...metadata,
        uploadDate: new Date().toISOString(),
      },
    });

    await this.s3Client.send(command);

    const storageUrl = `https://${bucketName}.s3.${this.region}.amazonaws.com/${key}`;
    this.logger.log(`File uploaded to S3: ${key}`);

    return { storageUrl, key };
  }

  /**
   * Upload to local filesystem (internal method)
   */
  private async uploadToLocal(
    bucket: BucketType,
    key: string,
    file: Express.Multer.File,
  ): Promise<{ storageUrl: string; key: string }> {
    const filePath = path.join(this.localUploadPath, key);
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    try {
      await access(dirPath);
    } catch {
      await mkdir(dirPath, { recursive: true });
    }

    // Write file to disk
    await writeFile(filePath, file.buffer);

    const storageUrl = `${this.publicUrl}/uploads/${key}`;
    this.logger.log(`File uploaded locally: ${key}`);

    return { storageUrl, key };
  }

  /**
   * Delete from S3 (internal method)
   */
  private async deleteFromS3(bucket: BucketType, key: string): Promise<void> {
    if (!this.s3Client) {
      throw new BadRequestException('S3 client not initialized');
    }

    const bucketName = this.getBucketName(bucket);
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  /**
   * Delete from local filesystem (internal method)
   */
  private async deleteFromLocal(key: string): Promise<void> {
    const filePath = path.join(this.localUploadPath, key);

    try {
      await unlink(filePath);
    } catch (error) {
      // File might not exist, ignore error
      this.logger.debug(`File not found for deletion: ${filePath}`);
    }
  }

  /**
   * Get bucket name by type
   */
  private getBucketName(bucket: BucketType): string {
    switch (bucket) {
      case 'cv':
        return this.cvBucket;
      case 'audio':
        return this.audioBucket;
      case 'avatar':
        return this.avatarsBucket;
      default:
        throw new BadRequestException('Invalid bucket type');
    }
  }

  /**
   * Extract key from URL (works for both S3 and local URLs)
   */
  extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // For local URLs: http://localhost:3000/uploads/cvs/file.pdf
      if (urlObj.pathname.includes('/uploads/')) {
        return urlObj.pathname.substring(urlObj.pathname.indexOf('/uploads/') + 9);
      }

      // For S3 URLs: https://bucket.s3.region.amazonaws.com/key
      return urlObj.pathname.substring(1);
    } catch (error) {
      this.logger.error(`Failed to extract key from URL: ${error.message}`);
      return null;
    }
  }

  /**
   * Get storage mode (for debugging/info)
   */
  getStorageMode(): StorageMode {
    return this.storageMode;
  }

  /**
   * Get storage info (for debugging/info)
   */
  getStorageInfo(): { mode: StorageMode; path?: string; region?: string } {
    return {
      mode: this.storageMode,
      ...(this.storageMode === 'local' && { path: this.localUploadPath }),
      ...(this.storageMode === 's3' && { region: this.region }),
    };
  }
}
