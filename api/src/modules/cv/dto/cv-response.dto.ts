import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PersonalInfoDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  name?: string;

  @ApiPropertyOptional({ example: 'john.doe@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  phone?: string;

  @ApiPropertyOptional({ example: 'San Francisco, CA' })
  location?: string;

  @ApiPropertyOptional({ example: 'https://linkedin.com/in/johndoe' })
  linkedin?: string;

  @ApiPropertyOptional({ example: 'https://github.com/johndoe' })
  github?: string;

  @ApiPropertyOptional({ example: 'https://johndoe.com' })
  website?: string;
}

class ExperienceDto {
  @ApiProperty({ example: 'Senior Backend Developer' })
  title: string;

  @ApiProperty({ example: 'Google' })
  company: string;

  @ApiPropertyOptional({ example: 'Mountain View, CA' })
  location?: string;

  @ApiPropertyOptional()
  startDate?: Date;

  @ApiPropertyOptional()
  endDate?: Date;

  @ApiProperty({ example: false })
  current: boolean;

  @ApiProperty({ example: 'Led team of 5 developers...' })
  description: string;

  @ApiProperty({ example: ['Increased API performance by 40%'], type: [String] })
  achievements: string[];

  @ApiPropertyOptional({ example: ['Node.js', 'MongoDB', 'Docker'], type: [String] })
  technologies?: string[];
}

class EducationDto {
  @ApiProperty({ example: 'Bachelor of Science in Computer Science' })
  degree: string;

  @ApiProperty({ example: 'Stanford University' })
  institution: string;

  @ApiPropertyOptional({ example: 'Stanford, CA' })
  location?: string;

  @ApiPropertyOptional()
  graduationDate?: Date;

  @ApiPropertyOptional({ example: 3.8 })
  gpa?: number;

  @ApiPropertyOptional({ example: 'Computer Science' })
  major?: string;
}

class CertificationDto {
  @ApiProperty({ example: 'AWS Certified Solutions Architect' })
  name: string;

  @ApiPropertyOptional({ example: 'Amazon Web Services' })
  issuer?: string;

  @ApiPropertyOptional()
  date?: Date;

  @ApiPropertyOptional({ example: 'https://aws.amazon.com/certification/' })
  url?: string;
}

class ProjectDto {
  @ApiProperty({ example: 'E-commerce Platform' })
  name: string;

  @ApiProperty({ example: 'Built scalable microservices architecture...' })
  description: string;

  @ApiProperty({ example: ['Node.js', 'React', 'MongoDB'], type: [String] })
  technologies: string[];

  @ApiPropertyOptional({ example: 'https://github.com/user/project' })
  url?: string;
}

class ParsedDataDto {
  @ApiProperty({ type: PersonalInfoDto })
  personalInfo: PersonalInfoDto;

  @ApiPropertyOptional({ example: 'Experienced software engineer with 5+ years...' })
  summary?: string;

  @ApiProperty({ type: [ExperienceDto] })
  experience: ExperienceDto[];

  @ApiProperty({ type: [EducationDto] })
  education: EducationDto[];

  @ApiProperty({ example: ['Node.js', 'Python', 'Docker'], type: [String] })
  skills: string[];

  @ApiProperty({ example: ['English', 'Spanish'], type: [String] })
  languages: string[];

  @ApiProperty({ type: [CertificationDto] })
  certifications: CertificationDto[];

  @ApiPropertyOptional({ type: [ProjectDto] })
  projects?: ProjectDto[];
}

class SuggestionDto {
  @ApiProperty({ example: 'content' })
  category: string;

  @ApiProperty({ example: 'high' })
  severity: string;

  @ApiProperty({ example: 'Add more quantifiable achievements' })
  message: string;

  @ApiProperty({ example: 'Use specific numbers and percentages' })
  suggestion: string;

  @ApiPropertyOptional({ example: 'Increased sales by 40%' })
  example?: string;
}

class SectionScoresDto {
  @ApiProperty({ example: 85 })
  personalInfo: number;

  @ApiProperty({ example: 70 })
  summary: number;

  @ApiProperty({ example: 90 })
  experience: number;

  @ApiProperty({ example: 80 })
  education: number;

  @ApiProperty({ example: 75 })
  skills: number;

  @ApiProperty({ example: 65 })
  formatting: number;
}

class AnalysisDto {
  @ApiProperty({ example: 78 })
  atsScore: number;

  @ApiProperty({ example: 4 })
  overallRating: number;

  @ApiProperty({ example: ['Strong work history', 'Good technical skills'], type: [String] })
  strengths: string[];

  @ApiProperty({ example: ['Missing quantifiable achievements'], type: [String] })
  weaknesses: string[];

  @ApiProperty({ example: ['leadership', 'agile'], type: [String] })
  missingKeywords: string[];

  @ApiProperty({ type: [SuggestionDto] })
  suggestions: SuggestionDto[];

  @ApiProperty({ type: SectionScoresDto })
  sectionScores: SectionScoresDto;

  @ApiProperty()
  analyzedAt: Date;

  @ApiProperty({ example: 'gpt-4' })
  aiModel: string;
}

export class CvResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  userId: string;

  @ApiProperty({ example: 'resume.pdf' })
  fileName: string;

  @ApiProperty({ example: 1024000 })
  fileSize: number;

  @ApiProperty({ example: 'application/pdf' })
  mimeType: string;

  @ApiProperty({ example: 'https://s3.amazonaws.com/bucket/cvs/...' })
  storageUrl: string;

  @ApiProperty({ example: 1 })
  version: number;

  @ApiPropertyOptional()
  parsedText?: string;

  @ApiProperty({ type: ParsedDataDto })
  parsedData: ParsedDataDto;

  @ApiPropertyOptional({ type: AnalysisDto })
  analysis?: AnalysisDto;

  @ApiProperty({ example: 'completed' })
  analysisStatus: string;

  @ApiPropertyOptional()
  analysisError?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
