import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Career Path Schema
 *
 * Represents different IT career specializations.
 * Each user selects ONE career path during onboarding.
 *
 * SCALABILITY:
 * - 1000+ career paths supported
 * - Questions generated per (path + position + week)
 * - Same questions shared across ALL users in segment
 */

@Schema({ timestamps: true })
export class CareerPath {
  @Prop({ required: true, unique: true })
  slug: string; // 'frontend-developer', 'backend-nodejs', 'devops-aws'

  @Prop({ required: true })
  name: {
    uz: string;
    ru: string;
    en: string;
  };

  @Prop({ required: true })
  category: string; // 'software-engineering', 'data-science', 'devops', etc.

  @Prop({ type: [String], default: [] })
  commonTechnologies: string[]; // ['React', 'TypeScript', 'Next.js']

  @Prop({ type: [String], default: [] })
  relatedPaths: string[]; // ['fullstack-developer', 'react-developer']

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  userCount: number; // How many users selected this path
}

export type CareerPathDocument = CareerPath & Document;
export const CareerPathSchema = SchemaFactory.createForClass(CareerPath);

// Indexes
CareerPathSchema.index({ slug: 1 }, { unique: true });
CareerPathSchema.index({ category: 1 });
CareerPathSchema.index({ isActive: 1, userCount: -1 }); // Popular active paths
