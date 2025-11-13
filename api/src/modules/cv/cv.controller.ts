import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { CvService } from './cv.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';
import { ParseObjectIdPipe } from '@common/pipes/parse-objectid.pipe';
import { UploadCvDto } from './dto/upload-cv.dto';
import { AnalyzeCvDto } from './dto/analyze-cv.dto';
import { OptimizeCvDto } from './dto/optimize-cv.dto';
import { CvResponseDto } from './dto/cv-response.dto';

@ApiTags('CV Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cv')
export class CvController {
  constructor(private readonly cvService: CvService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload CV',
    description:
      'Upload CV file for parsing and analysis. Supports PDF, DOCX, and TXT formats. Max size: 5MB.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CV file (PDF, DOCX, or TXT)',
        },
        jobDescription: {
          type: 'string',
          description: 'Optional job description for tailored analysis',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'CV uploaded successfully',
    type: CvResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid file or format' })
  @ApiResponse({ status: 403, description: 'Forbidden - Usage limit exceeded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async uploadCv(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadCvDto: UploadCvDto,
  ) {
    return await this.cvService.uploadCv(user.id, file, uploadCvDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get user CVs',
    description: 'Retrieve list of CVs uploaded by the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'CVs retrieved successfully',
    type: [CvResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserCvs(
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: number,
    @Query('skip') skip?: number,
  ) {
    return await this.cvService.getUserCvs(user.id, limit, skip);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get CV by ID',
    description: 'Retrieve detailed CV information including analysis results',
  })
  @ApiResponse({
    status: 200,
    description: 'CV retrieved successfully',
    type: CvResponseDto,
  })
  @ApiResponse({ status: 404, description: 'CV not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCvById(@CurrentUser() user: RequestUser, @Param('id', ParseObjectIdPipe) id: string) {
    return await this.cvService.getCvById(user.id, id);
  }

  @Post(':id/analyze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Analyze CV',
    description:
      'Trigger AI-powered CV analysis. Returns ATS score, strengths, weaknesses, and suggestions.',
  })
  @ApiResponse({
    status: 200,
    description: 'CV analysis completed',
    type: CvResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Analysis already in progress' })
  @ApiResponse({ status: 404, description: 'CV not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async analyzeCv(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AnalyzeCvDto,
  ) {
    return await this.cvService.analyzeCv(user.id, id, dto);
  }

  @Post(':id/optimize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Optimize CV',
    description: 'AI-powered CV optimization based on target role, company, and job description.',
  })
  @ApiResponse({
    status: 200,
    description: 'CV optimization completed',
    schema: {
      type: 'object',
      properties: {
        originalCvId: { type: 'string' },
        optimizedContent: { type: 'string' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              section: { type: 'string' },
              type: { type: 'string', enum: ['addition', 'modification', 'deletion'] },
              original: { type: 'string' },
              optimized: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
        newAtsScore: { type: 'number' },
        improvement: { type: 'number' },
        generatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'CV must be analyzed first' })
  @ApiResponse({ status: 404, description: 'CV not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async optimizeCv(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: OptimizeCvDto,
  ) {
    return await this.cvService.optimizeCv(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete CV',
    description: 'Delete CV and associated files from storage',
  })
  @ApiResponse({ status: 204, description: 'CV deleted successfully' })
  @ApiResponse({ status: 404, description: 'CV not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteCv(@CurrentUser() user: RequestUser, @Param('id', ParseObjectIdPipe) id: string) {
    await this.cvService.deleteCv(user.id, id);
  }
}
