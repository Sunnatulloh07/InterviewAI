import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type CvDocument = Cv & Document;

@Schema({ timestamps: true })
export class Cv {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  storageUrl: string;

  @Prop()
  storageKey?: string;

  @Prop({ default: 1 })
  version: number;

  @Prop({ type: String })
  parsedText?: string;

  @Prop({ type: Object, default: {} })
  parsedData: {
    personalInfo: {
      name?: string;
      email?: string;
      phone?: string;
      location?: string;
      linkedin?: string;
      github?: string;
      website?: string;
    };
    summary?: string;
    experience: Array<{
      title: string;
      company: string;
      location?: string;
      startDate?: Date;
      endDate?: Date;
      current: boolean;
      description: string;
      achievements: string[];
      technologies?: string[];
    }>;
    education: Array<{
      degree: string;
      institution: string;
      location?: string;
      graduationDate?: Date;
      gpa?: number;
      major?: string;
    }>;
    skills: string[];
    languages: string[];
    certifications: Array<{
      name: string;
      issuer?: string;
      date?: Date;
      url?: string;
    }>;
    projects?: Array<{
      name: string;
      description: string;
      technologies: string[];
      url?: string;
    }>;
  };

  @Prop({ type: Object })
  analysis?: {
    atsScore: number;
    overallRating: number;
    strengths: string[];
    weaknesses: string[];
    missingKeywords: string[];
    suggestions: Array<{
      category: 'content' | 'formatting' | 'keywords' | 'grammar' | 'achievements';
      severity: 'low' | 'medium' | 'high' | 'critical';
      message: string;
      suggestion: string;
      example?: string;
    }>;
    sectionScores: {
      personalInfo: number;
      summary: number;
      experience: number;
      education: number;
      skills: number;
      formatting: number;
    };
    analyzedAt: Date;
    aiModel: string;
  };

  @Prop({
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true,
  })
  analysisStatus: string;

  @Prop()
  analysisError?: string;

  @Prop()
  jobDescription?: string;
}

export const CvSchema = SchemaFactory.createForClass(Cv);

// Indexes
CvSchema.index({ userId: 1, createdAt: -1 });
CvSchema.index({ analysisStatus: 1 });
CvSchema.index({ 'analysis.atsScore': -1 });

// Transform to JSON
CvSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
