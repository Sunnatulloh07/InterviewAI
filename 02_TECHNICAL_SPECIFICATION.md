# InterviewAI Pro - Technical Specification Document (TZ)

## Document Information
- **Document Type:** Technical Specification (Техническое Задание)
- **Version:** 1.0.0
- **Date:** November 2025
- **Status:** For Development
- **Confidentiality:** Internal Use Only

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Functional Requirements](#2-functional-requirements)
3. [Non-Functional Requirements](#3-non-functional-requirements)
4. [System Architecture](#4-system-architecture)
5. [Data Models](#5-data-models)
6. [API Specifications](#6-api-specifications)
7. [Security Requirements](#7-security-requirements)
8. [Integration Requirements](#8-integration-requirements)
9. [Testing Requirements](#9-testing-requirements)
10. [Deployment Requirements](#10-deployment-requirements)

---

## 1. System Overview

### 1.1 Purpose
InterviewAI Pro is a multi-platform AI-powered interview preparation system consisting of:
- Web Application (React-based Dashboard)
- Chrome Browser Extension (Real-time Interview Assistant)
- Telegram Bot (Mobile Interview Coach)
- Backend API (NestJS Microservices)

### 1.2 Scope

#### In Scope:
- User authentication and authorization
- CV/Resume upload, parsing, and analysis
- Real-time audio transcription (Speech-to-Text)
- AI-powered answer generation
- Mock interview simulations
- Chrome extension with stealth mode
- Telegram bot with voice message support
- Multi-language support (8+ languages)
- Payment processing and subscription management
- Analytics and reporting

#### Out of Scope (Future Phases):
- Native mobile applications (iOS/Android)
- Video interview recording
- Blockchain integration
- Job board integration
- Recruiter dashboard

### 1.3 Definitions and Acronyms

| Term | Definition |
|------|------------|
| STT | Speech-to-Text |
| TTS | Text-to-Speech |
| JWT | JSON Web Token |
| RBAC | Role-Based Access Control |
| MQ | Message Queue |
| WS | WebSocket |
| CV | Curriculum Vitae / Resume |
| ATS | Applicant Tracking System |
| LLM | Large Language Model |

---

## 2. Functional Requirements

### 2.1 User Management Module (UM)

#### UM-001: User Registration
**Priority:** Critical  
**Description:** Users must be able to register using email or social auth  

**Acceptance Criteria:**
- Email + password registration with email verification
- OAuth 2.0 integration (Google, GitHub)
- Password strength validation (min 8 chars, uppercase, lowercase, number, special char)
- Email verification link valid for 24 hours
- Automatic email resend capability
- CAPTCHA for bot prevention

**Technical Requirements:**
```typescript
// Registration DTO
interface RegisterDto {
  email: string;        // Valid email format
  password: string;     // Min 8 chars, complex
  firstName: string;    // Max 50 chars
  lastName: string;     // Max 50 chars
  language: string;     // ISO 639-1 code (en, uz, ru, etc.)
  termsAccepted: boolean; // Must be true
}

// Response
interface RegisterResponse {
  success: boolean;
  message: string;
  userId?: string;
  verificationSent: boolean;
}
```

#### UM-002: User Authentication
**Priority:** Critical  
**Description:** Secure login with JWT tokens  

**Acceptance Criteria:**
- JWT access token (15 min expiry)
- Refresh token (7 days expiry)
- Secure HTTP-only cookies for refresh tokens
- Rate limiting: 5 failed attempts = 15 min lockout
- Multi-device session management
- Force logout capability

**Technical Requirements:**
```typescript
// Login DTO
interface LoginDto {
  email: string;
  password: string;
  rememberMe?: boolean;
}

// JWT Payload
interface JwtPayload {
  sub: string;          // User ID
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

// Response
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
  expiresIn: number;
}
```

#### UM-003: User Profile Management
**Priority:** High  
**Description:** Users can view and update their profiles  

**Acceptance Criteria:**
- View profile information
- Update personal details (name, avatar, bio)
- Change password
- Set preferences (language, notification settings)
- Delete account (soft delete with 30-day grace period)

**Technical Requirements:**
```typescript
interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  bio?: string;
  role: UserRole;
  language: string;
  preferences: UserPreferences;
  subscription: SubscriptionInfo;
  createdAt: Date;
  updatedAt: Date;
}

interface UserPreferences {
  notifications: {
    email: boolean;
    telegram: boolean;
    push: boolean;
  };
  interviewSettings: {
    answerStyle: 'professional' | 'balanced' | 'simple';
    answerLength: 'short' | 'medium' | 'long';
    autoTranscribe: boolean;
  };
  privacy: {
    saveHistory: boolean;
    shareAnalytics: boolean;
  };
}
```

### 2.2 CV Management Module (CV)

#### CV-001: CV Upload
**Priority:** Critical  
**Description:** Users can upload their CV/Resume for analysis  

**Acceptance Criteria:**
- Supported formats: PDF, DOCX, TXT
- Max file size: 5MB
- File validation (virus scanning)
- Automatic parsing and text extraction
- Preview before save
- Version history (keep last 5 versions)

**Technical Requirements:**
```typescript
interface UploadCvDto {
  file: Express.Multer.File;
  jobDescription?: string;  // Optional: for tailored analysis
}

interface CvDocument {
  id: string;
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageUrl: string;       // S3/Cloud storage URL
  parsedText: string;
  parsedData: ParsedCvData;
  version: number;
  uploadedAt: Date;
  analysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
  analysis?: CvAnalysis;
}

interface ParsedCvData {
  personalInfo: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
  };
  summary?: string;
  experience: ExperienceItem[];
  education: EducationItem[];
  skills: string[];
  languages: string[];
  certifications: string[];
}
```

#### CV-002: CV Analysis
**Priority:** Critical  
**Description:** AI-powered analysis of uploaded CV  

**Acceptance Criteria:**
- ATS score calculation (0-100)
- Keyword analysis
- Strengths and weaknesses identification
- Formatting suggestions
- Content improvement recommendations
- Comparison with job description (if provided)

**Technical Requirements:**
```typescript
interface CvAnalysis {
  id: string;
  cvId: string;
  atsScore: number;         // 0-100
  overallRating: number;    // 1-5 stars
  strengths: string[];
  weaknesses: string[];
  missingKeywords: string[];
  suggestions: Suggestion[];
  sectionScores: {
    personalInfo: number;
    summary: number;
    experience: number;
    education: number;
    skills: number;
    formatting: number;
  };
  analyzedAt: Date;
  aiModel: string;          // e.g., "gpt-4", "claude-3.5"
}

interface Suggestion {
  category: 'content' | 'formatting' | 'keywords' | 'grammar';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  suggestion: string;
  example?: string;
}
```

#### CV-003: CV Optimization
**Priority:** High  
**Description:** AI-powered CV improvement and optimization  

**Acceptance Criteria:**
- Auto-fix grammar and spelling errors
- Keyword optimization based on job description
- Action verb suggestions
- Achievement quantification suggestions
- Format optimization
- Generate multiple tailored versions

**Technical Requirements:**
```typescript
interface OptimizeCvDto {
  cvId: string;
  targetRole?: string;
  targetCompany?: string;
  jobDescription?: string;
  optimizationLevel: 'light' | 'moderate' | 'aggressive';
}

interface OptimizedCv {
  originalCvId: string;
  optimizedContent: string;
  changes: CvChange[];
  newAtsScore: number;
  improvement: number;      // Percentage improvement
  generatedAt: Date;
}

interface CvChange {
  section: string;
  type: 'addition' | 'modification' | 'deletion';
  original: string;
  optimized: string;
  reason: string;
}
```

### 2.3 Mock Interview Module (MI)

#### MI-001: Start Mock Interview
**Priority:** Critical  
**Description:** Users can start AI-powered mock interview sessions  

**Acceptance Criteria:**
- Select interview type (technical, behavioral, case study)
- Select difficulty level (junior, mid, senior)
- Select specific technology/domain
- Set number of questions
- Choose audio or text mode
- Time-boxed sessions (optional)

**Technical Requirements:**
```typescript
interface StartMockInterviewDto {
  type: 'technical' | 'behavioral' | 'case_study' | 'mixed';
  difficulty: 'junior' | 'mid' | 'senior';
  domain?: string;          // e.g., "frontend", "backend", "devops"
  technology?: string[];    // e.g., ["react", "node.js"]
  numQuestions: number;     // 5-20
  mode: 'audio' | 'text';
  timeLimit?: number;       // Minutes per question
}

interface MockInterviewSession {
  id: string;
  userId: string;
  config: StartMockInterviewDto;
  status: 'active' | 'paused' | 'completed';
  currentQuestionIndex: number;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  startedAt: Date;
  completedAt?: Date;
  overallScore?: number;
  feedback?: InterviewFeedback;
}

interface InterviewQuestion {
  id: string;
  order: number;
  category: string;
  difficulty: string;
  question: string;
  expectedKeyPoints: string[];
  timeLimit?: number;
  hints?: string[];
}
```

#### MI-002: Answer Question
**Priority:** Critical  
**Description:** Users provide answers in text or audio format  

**Acceptance Criteria:**
- Support text input
- Support audio recording (max 5 minutes)
- Auto-save draft answers
- Timer display (if time-limited)
- Ability to skip questions
- Ability to pause session

**Technical Requirements:**
```typescript
interface SubmitAnswerDto {
  sessionId: string;
  questionId: string;
  answerType: 'text' | 'audio';
  answerText?: string;
  audioUrl?: string;        // If audio, S3 URL
  duration: number;         // Seconds taken
  transcript?: string;      // For audio answers
}

interface InterviewAnswer {
  id: string;
  questionId: string;
  answerType: 'text' | 'audio';
  content: string;          // Text or transcript
  audioUrl?: string;
  submittedAt: Date;
  duration: number;
  score?: number;           // 0-10
  feedback?: AnswerFeedback;
}

interface AnswerFeedback {
  score: number;            // 0-10
  strengths: string[];
  improvements: string[];
  keyPointsCovered: string[];
  keyPointsMissed: string[];
  suggestions: string[];
  exampleAnswer?: string;
}
```

#### MI-003: Session Analytics
**Priority:** High  
**Description:** Comprehensive analytics after interview completion  

**Acceptance Criteria:**
- Overall session score
- Individual question scores
- Time management analysis
- Strengths and weaknesses summary
- Detailed feedback for each answer
- Comparison with ideal answers
- Progress tracking over time

**Technical Requirements:**
```typescript
interface InterviewFeedback {
  sessionId: string;
  overallScore: number;     // 0-100
  ratings: {
    technicalAccuracy: number;
    communication: number;
    structuredThinking: number;
    confidence: number;
    problemSolving: number;
  };
  summary: {
    strengths: string[];
    weaknesses: string[];
    topConcerns: string[];
  };
  recommendations: string[];
  comparisonWithPreviousSessions?: ComparisonData;
}
```

### 2.4 Chrome Extension Module (CE)

#### CE-001: Real-time Audio Capture
**Priority:** Critical  
**Description:** Capture and transcribe interview audio in real-time  

**Acceptance Criteria:**
- Access microphone with user permission
- Real-time audio streaming
- Automatic speech detection (silence vs speech)
- Support for multiple audio inputs
- Noise cancellation (optional)
- Audio quality indicator

**Technical Requirements:**
```typescript
// Chrome Extension - Background Script
interface AudioCaptureConfig {
  sampleRate: number;       // 16000 Hz recommended
  channels: number;         // 1 for mono
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

interface AudioChunk {
  data: Float32Array;       // Audio samples
  timestamp: number;
  duration: number;
  sessionId: string;
}

// Send to backend via WebSocket
interface TranscriptionRequest {
  sessionId: string;
  audioChunk: string;       // Base64 encoded
  language: string;
  context?: string;         // Previous transcript for context
}
```

#### CE-002: Screen Share Detection
**Priority:** Critical  
**Description:** Detect when user is screen sharing and activate stealth mode  

**Acceptance Criteria:**
- Detect Chrome screen sharing
- Detect Zoom/Meet/Teams screen sharing
- Auto-hide UI elements when sharing detected
- Notify user of stealth mode activation
- Manual override option

**Technical Requirements:**
```typescript
// Screen Share Detector
class ScreenShareDetector {
  private checkInterval: number = 1000; // Check every 1 sec
  
  async isScreenSharing(): Promise<boolean> {
    // Check if getDisplayMedia is active
    const stream = await navigator.mediaDevices.getDisplayMedia();
    return stream.active;
  }
  
  enableStealthMode(): void {
    // Hide all visible UI elements
    chrome.runtime.sendMessage({ type: 'ENABLE_STEALTH' });
    
    // Redirect output to alternative channels
    this.switchToBackgroundMode();
  }
  
  switchToBackgroundMode(): void {
    // Continue capturing audio
    // Continue AI processing
    // Output via Telegram/Clipboard only
  }
}
```

#### CE-003: Answer Display and Output
**Priority:** Critical  
**Description:** Display AI-generated answers in multiple formats  

**Acceptance Criteria:**
- Overlay panel (when not screen sharing)
- Clipboard auto-copy
- Telegram bot sync
- Multiple answer variations (professional, balanced, simple)
- Key points highlighting
- Copy individual sections

**Technical Requirements:**
```typescript
interface AnswerDisplayConfig {
  mode: 'overlay' | 'clipboard' | 'telegram' | 'hidden';
  position: 'top-right' | 'bottom-right' | 'custom';
  autoHide: boolean;
  autoHideDelay: number;    // Seconds
  fontSize: number;
  theme: 'light' | 'dark' | 'auto';
}

interface AIAnswer {
  questionTranscript: string;
  answers: {
    professional: string;
    balanced: string;
    simple: string;
  };
  keyPoints: string[];
  suggestedFollowups: string[];
  confidence: number;       // 0-1
  generatedAt: Date;
  processingTime: number;   // Milliseconds
}
```

#### CE-004: Screenshot OCR
**Priority:** High  
**Description:** Capture and analyze screenshots for coding questions  

**Acceptance Criteria:**
- Hotkey for screenshot capture
- Automatic OCR for text extraction
- Code syntax highlighting detection
- Send to AI for analysis
- Display solution/explanation
- Support for multiple programming languages

**Technical Requirements:**
```typescript
interface ScreenshotAnalysisRequest {
  image: string;            // Base64 encoded
  context?: string;
  expectedLanguage?: string;
  analysisType: 'code' | 'diagram' | 'text' | 'mixed';
}

interface ScreenshotAnalysisResponse {
  extractedText: string;
  detectedLanguage?: string;
  codeBlocks?: CodeBlock[];
  analysis: string;
  solution?: string;
  explanation?: string;
}

interface CodeBlock {
  language: string;
  code: string;
  lineNumbers: boolean;
  syntax: string[];
}
```

### 2.5 Telegram Bot Module (TB)

#### TB-001: Bot Commands
**Priority:** Critical  
**Description:** Core Telegram bot commands  

**Acceptance Criteria:**
- /start - Initialize bot and create profile
- /profile - View/edit user profile
- /interview - Start mock interview
- /analyze_cv - Analyze uploaded CV
- /help - Display help information
- /settings - Manage bot settings
- /stats - View interview statistics

**Technical Requirements:**
```typescript
// Grammy (Telegram bot framework) handlers
import { Bot, Context } from 'grammy';

interface TelegramBotContext extends Context {
  session: {
    userId: string;
    currentInterview?: string;
    lastCommand?: string;
  };
}

// Command handlers
async function handleStart(ctx: TelegramBotContext) {
  // Initialize user in database
  // Send welcome message with inline keyboard
}

async function handleProfile(ctx: TelegramBotContext) {
  // Fetch user profile from backend
  // Display with inline keyboard for editing
}
```

#### TB-002: Voice Message Processing
**Priority:** Critical  
**Description:** Process voice messages as interview questions  

**Acceptance Criteria:**
- Accept voice messages (max 5 minutes)
- Download and transcode audio
- Transcribe to text
- Detect language automatically
- Generate AI response
- Send response in <5 seconds
- Support for all target languages

**Technical Requirements:**
```typescript
interface VoiceMessageHandler {
  async handle(ctx: TelegramBotContext): Promise<void> {
    const voiceFile = ctx.message.voice;
    
    // 1. Download voice file
    const audioBuffer = await this.downloadVoice(voiceFile.file_id);
    
    // 2. Transcribe (Whisper API)
    const transcript = await this.transcribe(audioBuffer, ctx.from.language_code);
    
    // 3. Detect intent and generate response
    const response = await this.generateResponse(transcript, ctx.session);
    
    // 4. Send response
    await ctx.reply(response.text, {
      parse_mode: 'Markdown',
      reply_markup: this.buildKeyboard(response.suggestions)
    });
  }
}
```

#### TB-003: Live Interview Mode
**Priority:** Critical  
**Description:** Real-time interview assistance via Telegram  

**Acceptance Criteria:**
- Start live session with /start_live
- Continuous listening mode
- Voice or text input
- Instant AI responses
- Session recording
- Auto-save transcript
- End session with /end_live

**Technical Requirements:**
```typescript
interface LiveInterviewSession {
  id: string;
  userId: string;
  telegramChatId: number;
  status: 'active' | 'paused' | 'ended';
  startedAt: Date;
  messages: LiveMessage[];
  context: string;          // Accumulated context
  metadata: {
    jobRole?: string;
    company?: string;
    interviewType?: string;
  };
}

interface LiveMessage {
  timestamp: Date;
  type: 'question' | 'answer';
  content: string;
  audioUrl?: string;
  aiResponse?: string;
  processingTime: number;
}
```

### 2.6 AI Processing Module (AI)

#### AI-001: Speech-to-Text Processing
**Priority:** Critical  
**Description:** Convert audio to text using Whisper API  

**Acceptance Criteria:**
- Support for 8+ languages
- Real-time streaming (for Chrome extension)
- Batch processing (for uploaded files)
- Accuracy >95%
- Latency <2 seconds
- Fallback to alternative STT if primary fails

**Technical Requirements:**
```typescript
interface SttService {
  async transcribe(audio: Buffer, options: SttOptions): Promise<Transcription>;
}

interface SttOptions {
  language?: string;        // Auto-detect if not provided
  model?: 'whisper-1';
  prompt?: string;          // Context for better accuracy
  temperature?: number;     // 0-1, controls randomness
  format?: 'json' | 'text' | 'srt' | 'vtt';
}

interface Transcription {
  text: string;
  language: string;
  confidence: number;
  duration: number;
  segments: TranscriptSegment[];
}

interface TranscriptSegment {
  id: number;
  start: number;            // Seconds
  end: number;
  text: string;
  confidence: number;
}
```

#### AI-002: Answer Generation
**Priority:** Critical  
**Description:** Generate interview answers using LLM  

**Acceptance Criteria:**
- Support GPT-4, Claude 3.5, and fallback models
- Context-aware responses
- Multiple answer variations
- STAR method formatting (for behavioral)
- Code generation (for technical)
- Response time <3 seconds
- Cost optimization (model selection)

**Technical Requirements:**
```typescript
interface AnswerGenerationService {
  async generateAnswer(request: AnswerRequest): Promise<AnswerResponse>;
}

interface AnswerRequest {
  question: string;
  context: {
    userProfile: UserProfile;
    cvData: ParsedCvData;
    jobDescription?: string;
    previousQuestions?: string[];
    previousAnswers?: string[];
  };
  options: {
    style: 'professional' | 'balanced' | 'simple';
    length: 'short' | 'medium' | 'long';
    variations: number;       // Number of answer variations
    includeKeyPoints: boolean;
    includeFollowups: boolean;
  };
  model?: 'gpt-4' | 'gpt-3.5-turbo' | 'claude-3.5-sonnet';
}

interface AnswerResponse {
  answers: GeneratedAnswer[];
  processingTime: number;
  tokensUsed: number;
  model: string;
  cached: boolean;          // If response was cached
}

interface GeneratedAnswer {
  variant: string;          // 'professional', 'balanced', 'simple'
  content: string;
  keyPoints: string[];
  starMethod?: {            // For behavioral questions
    situation: string;
    task: string;
    action: string;
    result: string;
  };
  confidence: number;
  suggestedFollowups: string[];
}
```

#### AI-003: Context Management
**Priority:** High  
**Description:** Maintain conversation context for coherent responses  

**Acceptance Criteria:**
- Store last 10 Q&A pairs per session
- Detect follow-up questions
- Reference previous answers when relevant
- Identify contradictions
- Suggest clarifications

**Technical Requirements:**
```typescript
interface ContextManager {
  async updateContext(sessionId: string, message: Message): Promise<void>;
  async getContext(sessionId: string): Promise<SessionContext>;
  async detectFollowUp(question: string, context: SessionContext): Promise<boolean>;
}

interface SessionContext {
  sessionId: string;
  messages: ContextMessage[];
  topics: string[];
  mentionedExperiences: string[];
  skills: string[];
  lastUpdated: Date;
}

interface ContextMessage {
  timestamp: Date;
  role: 'user' | 'assistant';
  content: string;
  type: 'question' | 'answer';
  topics: string[];
}
```

### 2.7 Payment and Subscription Module (PS)

#### PS-001: Subscription Plans
**Priority:** Critical  
**Description:** Manage subscription tiers and features  

**Acceptance Criteria:**
- Free tier with limitations
- Pro tier ($14.99/month)
- Elite tier ($29.99/month)
- Enterprise tier (custom pricing)
- Monthly and annual billing
- 7-day free trial for Pro/Elite

**Technical Requirements:**
```typescript
interface SubscriptionPlan {
  id: string;
  name: 'free' | 'pro' | 'elite' | 'enterprise';
  price: {
    monthly: number;
    annual: number;
    currency: string;
  };
  features: PlanFeatures;
  limits: PlanLimits;
}

interface PlanFeatures {
  chromeExtension: boolean;
  telegramBot: boolean;
  cvAnalysis: boolean;
  cvOptimization: boolean;
  mockInterviews: boolean;
  stealthMode: boolean;
  voiceMessages: boolean;
  contextAwareness: boolean;
  advancedAI: boolean;        // GPT-4 vs GPT-3.5
  prioritySupport: boolean;
  customTraining: boolean;
}

interface PlanLimits {
  mockInterviewsPerMonth: number;   // -1 for unlimited
  cvAnalysesPerMonth: number;
  chromeQuestionsPerMonth: number;
  aiTokensPerMonth: number;
}
```

#### PS-002: Payment Processing
**Priority:** Critical  
**Description:** Process payments securely via Stripe  

**Acceptance Criteria:**
- Credit card payments (Stripe)
- PayPal integration
- Cryptocurrency (optional)
- Automatic billing
- Invoice generation
- Payment history
- Refund processing

**Technical Requirements:**
```typescript
interface PaymentService {
  async createCheckoutSession(dto: CheckoutDto): Promise<CheckoutSession>;
  async handleWebhook(event: Stripe.Event): Promise<void>;
  async cancelSubscription(userId: string): Promise<void>;
}

interface CheckoutDto {
  userId: string;
  planId: string;
  billingCycle: 'monthly' | 'annual';
  successUrl: string;
  cancelUrl: string;
}

interface CheckoutSession {
  sessionId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

// Stripe webhook events to handle
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];
```

### 2.8 Analytics Module (AN)

#### AN-001: User Analytics
**Priority:** Medium  
**Description:** Track user behavior and engagement  

**Acceptance Criteria:**
- Track page views
- Track feature usage
- Track session duration
- Track conversion funnel
- Track user retention
- Export analytics data

**Technical Requirements:**
```typescript
interface AnalyticsEvent {
  eventType: string;
  userId: string;
  sessionId: string;
  timestamp: Date;
  properties: Record<string, any>;
  metadata: {
    userAgent: string;
    ipAddress: string;
    referrer?: string;
    platform: 'web' | 'extension' | 'telegram';
  };
}

// Key events to track
enum EventType {
  // User events
  USER_REGISTERED = 'user_registered',
  USER_LOGGED_IN = 'user_logged_in',
  USER_SUBSCRIBED = 'user_subscribed',
  
  // CV events
  CV_UPLOADED = 'cv_uploaded',
  CV_ANALYZED = 'cv_analyzed',
  
  // Interview events
  MOCK_INTERVIEW_STARTED = 'mock_interview_started',
  MOCK_INTERVIEW_COMPLETED = 'mock_interview_completed',
  QUESTION_ANSWERED = 'question_answered',
  
  // Chrome extension events
  EXTENSION_INSTALLED = 'extension_installed',
  AUDIO_CAPTURED = 'audio_captured',
  ANSWER_GENERATED = 'answer_generated',
  STEALTH_MODE_ACTIVATED = 'stealth_mode_activated',
  
  // Telegram events
  BOT_STARTED = 'bot_started',
  VOICE_MESSAGE_SENT = 'voice_message_sent',
  LIVE_SESSION_STARTED = 'live_session_started',
}
```

---

## 3. Non-Functional Requirements

### 3.1 Performance Requirements

#### NFR-P-001: API Response Time
- **Target:** 95% of API requests must respond within 200ms
- **Critical Endpoints:** Authentication, profile loading
- **Acceptable:** 95th percentile <500ms
- **Maximum:** 99th percentile <1000ms

#### NFR-P-002: AI Response Time
- **Speech-to-Text:** <2 seconds for 30 sec audio
- **Answer Generation:** <3 seconds for standard questions
- **End-to-End:** <5 seconds (audio input to answer output)

#### NFR-P-003: Concurrent Users
- **Target:** Support 10,000 concurrent users
- **Peak Load:** Handle 2x normal load during peak hours
- **Database:** Query response time <50ms for indexed queries

#### NFR-P-004: Resource Utilization
- **CPU:** Average <70%, Peak <90%
- **Memory:** Backend service <2GB per instance
- **Database:** Disk I/O <80% utilization

### 3.2 Scalability Requirements

#### NFR-S-001: Horizontal Scaling
- Backend services must support horizontal scaling
- Stateless architecture for API services
- Load balancing across multiple instances

#### NFR-S-002: Database Scaling
- MongoDB sharding for horizontal scaling
- Read replicas for read-heavy operations
- Connection pooling (min: 10, max: 100 per service)

#### NFR-S-003: Caching Strategy
- Redis for session storage
- API response caching (5-minute TTL for frequent queries)
- CDN for static assets

### 3.3 Reliability Requirements

#### NFR-R-001: Availability
- **Target:** 99.9% uptime (SLA)
- **Downtime:** <43.8 minutes per month
- **Maintenance Window:** Weekly, 2 AM UTC, max 30 minutes

#### NFR-R-002: Data Durability
- Database backups: Daily full, hourly incremental
- Backup retention: 30 days
- Point-in-time recovery: Last 7 days
- Cross-region replication for critical data

#### NFR-R-003: Fault Tolerance
- Circuit breaker pattern for external services
- Graceful degradation (e.g., fallback to cached answers)
- Health checks every 30 seconds
- Auto-restart failed services

### 3.4 Security Requirements

#### NFR-SEC-001: Authentication
- JWT tokens with RS256 algorithm
- Token expiry: Access 15 min, Refresh 7 days
- Secure HTTP-only cookies for refresh tokens
- Password hashing: bcrypt with 12 rounds

#### NFR-SEC-002: Authorization
- RBAC with roles: user, pro, elite, admin
- API endpoint permissions check
- Resource-level access control

#### NFR-SEC-003: Data Protection
- Encryption at rest: AES-256
- Encryption in transit: TLS 1.3
- PII data masking in logs
- Audio files: Automatic deletion after 24 hours

#### NFR-SEC-004: API Security
- Rate limiting: 100 requests/minute per user
- CORS whitelist policy
- Input validation and sanitization
- SQL injection prevention (parameterized queries)
- XSS prevention (output encoding)

### 3.5 Compliance Requirements

#### NFR-C-001: GDPR Compliance
- User consent for data processing
- Right to access personal data
- Right to data portability
- Right to deletion (within 30 days)
- Data processing agreements

#### NFR-C-002: Data Retention
- User data: Retained while account active + 30 days after deletion
- Audio recordings: 24 hours (user can opt for longer)
- Logs: 90 days
- Backups: 30 days

### 3.6 Usability Requirements

#### NFR-U-001: Browser Compatibility
- Chrome: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest version
- Edge: Latest version

#### NFR-U-002: Mobile Responsiveness
- Web dashboard fully responsive
- Support for screens: 320px - 3840px width

#### NFR-U-003: Accessibility
- WCAG 2.1 Level AA compliance
- Keyboard navigation support
- Screen reader compatibility

### 3.7 Maintainability Requirements

#### NFR-M-001: Code Quality
- TypeScript strict mode
- ESLint configuration
- Code coverage: >80%
- Documentation for all public APIs

#### NFR-M-002: Monitoring
- Application performance monitoring (APM)
- Error tracking and alerting
- Log aggregation and search
- Real-time dashboards

#### NFR-M-003: Deployment
- CI/CD pipeline with automated tests
- Blue-green deployment strategy
- Rollback capability within 5 minutes
- Feature flags for gradual rollout

---

## 4. System Architecture

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
├──────────────┬──────────────────┬──────────────────────────┤
│   Web App    │  Chrome Extension │    Telegram Bot          │
│  (React.js)  │    (React.js)     │  (Grammy/Node.js)        │
└──────┬───────┴────────┬──────────┴──────────┬───────────────┘
       │                │                     │
       │                │                     │
       └────────────────┴─────────────────────┘
                        │
                        │ HTTPS / WSS
                        │
       ┌────────────────▼─────────────────────┐
       │         API GATEWAY (Nginx)          │
       │    - Load Balancing                  │
       │    - Rate Limiting                   │
       │    - SSL Termination                 │
       └────────────────┬─────────────────────┘
                        │
       ┌────────────────▼─────────────────────┐
       │     BACKEND SERVICES (NestJS)        │
       ├──────────────────────────────────────┤
       │  ┌──────────┐  ┌──────────┐         │
       │  │   Auth   │  │   User   │         │
       │  │ Service  │  │ Service  │         │
       │  └──────────┘  └──────────┘         │
       │  ┌──────────┐  ┌──────────┐         │
       │  │    CV    │  │Interview │         │
       │  │ Service  │  │ Service  │         │
       │  └──────────┘  └──────────┘         │
       │  ┌──────────┐  ┌──────────┐         │
       │  │    AI    │  │ Payment  │         │
       │  │ Service  │  │ Service  │         │
       │  └──────────┘  └──────────┘         │
       └────────┬───────────────────┬─────────┘
                │                   │
      ┌─────────▼────────┐  ┌──────▼────────┐
      │   MongoDB        │  │   Redis       │
      │  - User Data     │  │  - Sessions   │
      │  - Interview Data│  │  - Cache      │
      │  - Analytics     │  │  - MQ         │
      └──────────────────┘  └───────────────┘
                │
      ┌─────────▼────────────────┐
      │   External Services      │
      ├──────────────────────────┤
      │  - OpenAI API (GPT-4)    │
      │  - Whisper API (STT)     │
      │  - Stripe (Payments)     │
      │  - AWS S3 (Storage)      │
      │  - SendGrid (Email)      │
      └──────────────────────────┘
```

### 4.2 Microservices Architecture

```typescript
// Services structure
services/
├── auth-service/
│   ├── authentication
│   ├── authorization
│   └── session management
├── user-service/
│   ├── profile management
│   ├── preferences
│   └── settings
├── cv-service/
│   ├── upload/parsing
│   ├── analysis
│   └── optimization
├── interview-service/
│   ├── mock interviews
│   ├── question management
│   └── feedback generation
├── ai-service/
│   ├── speech-to-text
│   ├── answer generation
│   └── context management
├── payment-service/
│   ├── subscription management
│   ├── billing
│   └── invoicing
├── notification-service/
│   ├── email
│   ├── telegram
│   └── push notifications
└── analytics-service/
    ├── event tracking
    ├── reporting
    └── insights
```

### 4.3 Data Flow Diagrams

#### Chrome Extension Real-time Flow:
```
User speaks question
    │
    ▼
Chrome Extension captures audio
    │
    ▼
Send audio chunk via WebSocket
    │
    ▼
Backend AI Service
    ├─► Speech-to-Text (Whisper)
    │
    ▼
Transcribed text
    │
    ▼
Generate answer (GPT-4/Claude)
    │
    ├─► Check cache (Redis)
    ├─► Context manager
    └─► LLM API call
    │
    ▼
Answer response
    │
    ├─► Store in database
    ├─► Cache in Redis
    └─► Send to client
    │
    ▼
Display to user (<5 sec total)
```

---

## 5. Data Models

### 5.1 MongoDB Schemas

```typescript
// User Schema
interface User {
  _id: ObjectId;
  email: string;                    // Unique, indexed
  password: string;                 // Bcrypt hashed
  firstName: string;
  lastName: string;
  avatar?: string;
  role: 'user' | 'pro' | 'elite' | 'admin';
  emailVerified: boolean;
  telegramId?: number;              // Linked Telegram account
  subscription: {
    plan: 'free' | 'pro' | 'elite' | 'enterprise';
    status: 'active' | 'cancelled' | 'expired';
    startDate: Date;
    endDate?: Date;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  };
  preferences: {
    language: string;
    notifications: {
      email: boolean;
      telegram: boolean;
    };
    interviewSettings: {
      answerStyle: string;
      answerLength: string;
    };
  };
  usage: {
    mockInterviewsThisMonth: number;
    cvAnalysesThisMonth: number;
    chromeQuestionsThisMonth: number;
    lastResetDate: Date;
  };
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;                 // Soft delete
}

// CV Document Schema
interface CvDocument {
  _id: ObjectId;
  userId: ObjectId;                 // Indexed
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageUrl: string;
  version: number;
  parsedData: {
    personalInfo: {
      name?: string;
      email?: string;
      phone?: string;
      location?: string;
      linkedin?: string;
      github?: string;
    };
    summary?: string;
    experience: Array<{
      title: string;
      company: string;
      location?: string;
      startDate: Date;
      endDate?: Date;
      current: boolean;
      description: string;
      achievements: string[];
    }>;
    education: Array<{
      degree: string;
      institution: string;
      location?: string;
      graduationDate?: Date;
      gpa?: number;
    }>;
    skills: string[];
    languages: string[];
    certifications: string[];
  };
  analysis?: {
    atsScore: number;
    overallRating: number;
    strengths: string[];
    weaknesses: string[];
    suggestions: Array<{
      category: string;
      severity: string;
      message: string;
    }>;
    analyzedAt: Date;
    aiModel: string;
  };
  uploadedAt: Date;
  updatedAt: Date;
}

// Interview Session Schema
interface InterviewSession {
  _id: ObjectId;
  userId: ObjectId;                 // Indexed
  type: 'technical' | 'behavioral' | 'case_study' | 'mixed';
  difficulty: 'junior' | 'mid' | 'senior';
  domain?: string;
  technology?: string[];
  mode: 'audio' | 'text';
  status: 'active' | 'paused' | 'completed';
  questions: Array<{
    questionId: ObjectId;
    order: number;
    question: string;
    category: string;
    difficulty: string;
    answer?: {
      content: string;
      audioUrl?: string;
      submittedAt: Date;
      duration: number;              // Seconds
      score?: number;
      feedback?: {
        strengths: string[];
        improvements: string[];
        keyPointsCovered: string[];
        keyPointsMissed: string[];
      };
    };
  }>;
  overallScore?: number;
  feedback?: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };
  startedAt: Date;
  completedAt?: Date;
  duration?: number;                // Total seconds
}

// Question Bank Schema
interface InterviewQuestion {
  _id: ObjectId;
  category: string;                 // Indexed
  subcategory?: string;
  type: 'technical' | 'behavioral' | 'case_study';
  difficulty: 'junior' | 'mid' | 'senior';
  domain?: string;
  technology?: string[];            // Indexed
  question: string;
  context?: string;
  expectedKeyPoints: string[];
  sampleAnswer?: string;
  hints?: string[];
  followUpQuestions?: string[];
  timesAsked: number;
  averageScore?: number;
  tags: string[];                   // Indexed
  createdBy: 'system' | 'admin' | ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// Analytics Event Schema
interface AnalyticsEvent {
  _id: ObjectId;
  eventType: string;                // Indexed
  userId?: ObjectId;                // Indexed
  sessionId: string;
  timestamp: Date;                  // Indexed (TTL: 90 days)
  properties: Record<string, any>;
  metadata: {
    userAgent: string;
    ipAddress: string;
    platform: string;
    version: string;
  };
}

// API Usage Schema (for rate limiting and billing)
interface ApiUsage {
  _id: ObjectId;
  userId: ObjectId;                 // Indexed
  endpoint: string;
  method: string;
  timestamp: Date;                  // Indexed (TTL: 30 days)
  responseTime: number;
  statusCode: number;
  tokensUsed?: number;
  cost?: number;
}
```

### 5.2 Redis Data Structures

```typescript
// Session storage (JWT refresh tokens)
// Key: session:{userId}:{sessionId}
// TTL: 7 days
interface SessionData {
  userId: string;
  refreshToken: string;
  deviceInfo: string;
  lastActivity: number;
}

// Rate limiting
// Key: ratelimit:{userId}:{endpoint}
// TTL: 1 minute
// Value: request count (integer)

// API response cache
// Key: cache:api:{endpoint}:{params}
// TTL: 5 minutes
interface CachedResponse {
  data: any;
  timestamp: number;
  ttl: number;
}

// Active interview sessions (WebSocket)
// Key: ws:session:{sessionId}
// TTL: 2 hours
interface WebSocketSession {
  userId: string;
  socketId: string;
  connectedAt: number;
}

// AI response cache
// Key: ai:cache:{questionHash}
// TTL: 24 hours
interface AiResponseCache {
  question: string;
  answer: any;
  model: string;
  timestamp: number;
}

// Message queue (Bull)
// Queues:
// - email-queue
// - ai-processing-queue
// - cv-analysis-queue
// - notification-queue
```

---

## 6. API Specifications

### 6.1 REST API Endpoints

#### Authentication Endpoints

```typescript
// POST /api/v1/auth/register
Request:
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "language": "en"
}

Response: 201 Created
{
  "success": true,
  "message": "Registration successful. Please verify your email.",
  "userId": "64a1b2c3d4e5f6g7h8i9j0k1"
}

// POST /api/v1/auth/login
Request:
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}

Response: 200 OK
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "64a1b2c3d4e5f6g7h8i9j0k1",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "user"
  },
  "expiresIn": 900
}

// POST /api/v1/auth/refresh
Request:
{
  "refreshToken": "eyJhbGc..."
}

Response: 200 OK
{
  "accessToken": "eyJhbGc...",
  "expiresIn": 900
}

// POST /api/v1/auth/logout
Headers: Authorization: Bearer {accessToken}

Response: 200 OK
{
  "success": true,
  "message": "Logged out successfully"
}
```

#### User Endpoints

```typescript
// GET /api/v1/users/profile
Headers: Authorization: Bearer {accessToken}

Response: 200 OK
{
  "id": "64a1b2c3d4e5f6g7h8i9j0k1",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "avatar": "https://...",
  "role": "pro",
  "subscription": {
    "plan": "pro",
    "status": "active",
    "endDate": "2025-12-11T00:00:00Z"
  },
  "usage": {
    "mockInterviewsThisMonth": 5,
    "cvAnalysesThisMonth": 2
  }
}

// PATCH /api/v1/users/profile
Headers: Authorization: Bearer {accessToken}
Request:
{
  "firstName": "Jane",
  "bio": "Software engineer...",
  "preferences": {
    "language": "ru",
    "notifications": {
      "email": false
    }
  }
}

Response: 200 OK
{
  "success": true,
  "user": { /* updated user object */ }
}
```

#### CV Endpoints

```typescript
// POST /api/v1/cv/upload
Headers: 
  Authorization: Bearer {accessToken}
  Content-Type: multipart/form-data

Request:
FormData {
  file: File,
  jobDescription?: string
}

Response: 201 Created
{
  "cvId": "64b2c3d4e5f6g7h8i9j0k1l2",
  "fileName": "resume.pdf",
  "status": "processing",
  "message": "CV uploaded successfully. Analysis in progress."
}

// GET /api/v1/cv/:cvId
Headers: Authorization: Bearer {accessToken}

Response: 200 OK
{
  "cv": {
    "id": "64b2c3d4e5f6g7h8i9j0k1l2",
    "fileName": "resume.pdf",
    "parsedData": { /* parsed CV data */ },
    "analysis": {
      "atsScore": 78,
      "overallRating": 4,
      "strengths": [...],
      "weaknesses": [...],
      "suggestions": [...]
    }
  }
}

// POST /api/v1/cv/:cvId/optimize
Headers: Authorization: Bearer {accessToken}
Request:
{
  "targetRole": "Senior Backend Developer",
  "targetCompany": "Google",
  "optimizationLevel": "moderate"
}

Response: 200 OK
{
  "optimizedCv": {
    "content": "...",
    "changes": [...],
    "newAtsScore": 92,
    "improvement": 18
  }
}
```

#### Interview Endpoints

```typescript
// POST /api/v1/interviews/start
Headers: Authorization: Bearer {accessToken}
Request:
{
  "type": "technical",
  "difficulty": "mid",
  "domain": "backend",
  "technology": ["node.js", "mongodb"],
  "numQuestions": 10,
  "mode": "audio"
}

Response: 201 Created
{
  "sessionId": "64c3d4e5f6g7h8i9j0k1l2m3",
  "questions": [
    {
      "id": "q1",
      "order": 1,
      "question": "Explain the event loop in Node.js",
      "category": "technical",
      "timeLimit": 180
    },
    // ... more questions
  ]
}

// POST /api/v1/interviews/:sessionId/answer
Headers: Authorization: Bearer {accessToken}
Request:
{
  "questionId": "q1",
  "answerType": "audio",
  "audioUrl": "https://s3.amazonaws.com/...",
  "transcript": "The event loop is...",
  "duration": 120
}

Response: 200 OK
{
  "feedback": {
    "score": 8,
    "strengths": ["Clear explanation", "Good examples"],
    "improvements": ["Could mention libuv"],
    "keyPointsCovered": ["event loop phases", "callback queue"]
  }
}

// GET /api/v1/interviews/:sessionId/feedback
Headers: Authorization: Bearer {accessToken}

Response: 200 OK
{
  "sessionId": "64c3d4e5f6g7h8i9j0k1l2m3",
  "overallScore": 75,
  "ratings": {
    "technicalAccuracy": 8,
    "communication": 7,
    "problemSolving": 8
  },
  "summary": {
    "strengths": [...],
    "weaknesses": [...],
    "recommendations": [...]
  }
}
```

#### AI Processing Endpoints

```typescript
// POST /api/v1/ai/transcribe
Headers: Authorization: Bearer {accessToken}
Content-Type: multipart/form-data

Request:
FormData {
  audio: File,
  language?: string
}

Response: 200 OK
{
  "transcript": "Tell me about yourself...",
  "language": "en",
  "confidence": 0.96,
  "duration": 15.5
}

// POST /api/v1/ai/generate-answer
Headers: Authorization: Bearer {accessToken}
Request:
{
  "question": "Tell me about yourself",
  "context": {
    "userProfile": { /* user data */ },
    "cvData": { /* CV data */ }
  },
  "options": {
    "style": "professional",
    "length": "medium",
    "variations": 3
  }
}

Response: 200 OK
{
  "answers": [
    {
      "variant": "professional",
      "content": "I'm a software engineer...",
      "keyPoints": ["5 years experience", "Full-stack", "Team lead"],
      "confidence": 0.92
    },
    // ... more variants
  ],
  "processingTime": 2850,
  "cached": false
}
```

### 6.2 WebSocket API

```typescript
// WebSocket connection
ws://api.interviewai.pro/ws/audio

// Client -> Server messages

// 1. Start audio stream
{
  "type": "start_stream",
  "sessionId": "session123",
  "config": {
    "sampleRate": 16000,
    "language": "en"
  }
}

// 2. Audio chunk
{
  "type": "audio_chunk",
  "sessionId": "session123",
  "data": "base64_encoded_audio",
  "timestamp": 1699704000000
}

// 3. End stream
{
  "type": "end_stream",
  "sessionId": "session123"
}

// Server -> Client messages

// 1. Transcription result
{
  "type": "transcription",
  "sessionId": "session123",
  "text": "Tell me about yourself",
  "isFinal": true,
  "confidence": 0.96
}

// 2. AI answer
{
  "type": "answer",
  "sessionId": "session123",
  "answers": [
    {
      "variant": "professional",
      "content": "I'm a software engineer...",
      "keyPoints": [...]
    }
  ],
  "processingTime": 2850
}

// 3. Error
{
  "type": "error",
  "code": "TRANSCRIPTION_FAILED",
  "message": "Failed to transcribe audio"
}
```

---

## 7. Security Requirements

### 7.1 Authentication Security

```typescript
// JWT configuration
const JWT_CONFIG = {
  accessToken: {
    algorithm: 'RS256',           // RSA with SHA-256
    expiresIn: '15m',
    issuer: 'interviewai.pro',
    audience: 'interviewai-api'
  },
  refreshToken: {
    algorithm: 'RS256',
    expiresIn: '7d',
    issuer: 'interviewai.pro',
    audience: 'interviewai-api'
  }
};

// Password hashing
const PASSWORD_CONFIG = {
  algorithm: 'bcrypt',
  saltRounds: 12,
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true
};
```

### 7.2 API Security

```typescript
// Rate limiting configuration
const RATE_LIMITS = {
  global: {
    windowMs: 60000,              // 1 minute
    max: 100                      // 100 requests per minute
  },
  auth: {
    windowMs: 900000,             // 15 minutes
    max: 5                        // 5 login attempts
  },
  ai: {
    windowMs: 60000,
    max: 30                       // 30 AI requests per minute
  }
};

// CORS configuration
const CORS_CONFIG = {
  origin: [
    'https://interviewai.pro',
    'https://app.interviewai.pro',
    'chrome-extension://[EXTENSION_ID]'
  ],
  credentials: true,
  maxAge: 86400                   // 24 hours
};
```

### 7.3 Data Security

```typescript
// Encryption configuration
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-gcm',
  keyLength: 256,
  ivLength: 16,
  saltLength: 64,
  iterations: 100000
};

// Sensitive field encryption
const ENCRYPTED_FIELDS = [
  'user.password',
  'payment.cardNumber',
  'payment.cvv'
];

// PII data masking in logs
const PII_FIELDS = [
  'email',
  'phone',
  'address',
  'ssn'
];
```

---

## 8. Integration Requirements

### 8.1 External Services

#### OpenAI Integration
```typescript
interface OpenAIConfig {
  apiKey: string;
  organization?: string;
  models: {
    transcription: 'whisper-1';
    chat: 'gpt-4-turbo-preview' | 'gpt-3.5-turbo';
  };
  maxTokens: {
    answer: 1000;
    analysis: 2000;
  };
  temperature: number;            // 0-1
  timeout: number;                // milliseconds
  retries: number;
}
```

#### Stripe Integration
```typescript
interface StripeConfig {
  apiKey: string;
  webhookSecret: string;
  plans: {
    pro: {
      priceId: string;
      productId: string;
    };
    elite: {
      priceId: string;
      productId: string;
    };
  };
  successUrl: string;
  cancelUrl: string;
}
```

#### AWS S3 Integration
```typescript
interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  buckets: {
    cvDocuments: string;
    audioRecordings: string;
    avatars: string;
  };
  presignedUrlExpiry: number;     // seconds
}
```

### 8.2 Telegram Bot Integration

```typescript
// Grammy bot configuration
interface TelegramBotConfig {
  token: string;
  webhook: {
    url: string;
    port: number;
    path: string;
  };
  commands: BotCommand[];
  parseMode: 'Markdown' | 'HTML';
}

// Bot commands
const BOT_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Start the bot' },
  { command: 'profile', description: 'View your profile' },
  { command: 'interview', description: 'Start mock interview' },
  { command: 'analyze_cv', description: 'Analyze your CV' },
  { command: 'help', description: 'Get help' },
  { command: 'settings', description: 'Manage settings' },
  { command: 'start_live', description: 'Start live interview mode' },
  { command: 'end_live', description: 'End live session' }
];
```

---

## 9. Testing Requirements

### 9.1 Unit Testing
- **Coverage:** >80% for all services
- **Framework:** Jest
- **Focus areas:**
  - Business logic functions
  - Data transformations
  - Utility functions
  - Error handling

### 9.2 Integration Testing
- **Focus areas:**
  - API endpoints
  - Database operations
  - External service integrations
  - Authentication flows

### 9.3 End-to-End Testing
- **Framework:** Playwright
- **Test scenarios:**
  - User registration and login
  - CV upload and analysis
  - Mock interview flow
  - Chrome extension functionality
  - Telegram bot interactions

### 9.4 Performance Testing
- **Tools:** k6, Artillery
- **Test scenarios:**
  - Load testing (1000 concurrent users)
  - Stress testing (beyond capacity)
  - Spike testing (sudden traffic increase)
  - Endurance testing (sustained load)

### 9.5 Security Testing
- **Areas:**
  - Penetration testing
  - Vulnerability scanning
  - OWASP Top 10 compliance
  - API security testing

---

## 10. Deployment Requirements

### 10.1 Docker Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  # Backend API
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=mongodb://mongodb:27017/interviewai
      - REDIS_URL=redis://redis:6379
    depends_on:
      - mongodb
      - redis
    restart: unless-stopped
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '1'
          memory: 2G

  # MongoDB
  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
      - ./mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}
      - MONGO_INITDB_DATABASE=interviewai
    restart: unless-stopped

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    restart: unless-stopped

  # Nginx (Reverse Proxy)
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
    depends_on:
      - api
    restart: unless-stopped

  # Frontend (Production build)
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    ports:
      - "5173:80"
    restart: unless-stopped

volumes:
  mongodb_data:
  redis_data:
```

### 10.2 Environment Variables

```bash
# .env.production
NODE_ENV=production
PORT=3000

# Database
MONGODB_URI=mongodb://admin:password@mongodb:27017/interviewai?authSource=admin
REDIS_URL=redis://:password@redis:6379

# JWT
JWT_ACCESS_SECRET=your-access-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_ORGANIZATION=org-...

# Stripe
STRIPE_API_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AWS S3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET_CV=interviewai-cv-documents
AWS_S3_BUCKET_AUDIO=interviewai-audio-recordings

# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABC...
TELEGRAM_WEBHOOK_URL=https://api.interviewai.pro/telegram/webhook

# Email (SendGrid)
SENDGRID_API_KEY=SG...
FROM_EMAIL=noreply@interviewai.pro

# Monitoring
SENTRY_DSN=https://...

# Feature Flags
ENABLE_VOICE_MESSAGES=true
ENABLE_STEALTH_MODE=true
ENABLE_OFFLINE_MODE=false
```

### 10.3 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: Run linter
        run: npm run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker images
        run: docker-compose build
      - name: Push to registry
        run: |
          docker tag interviewai/api:latest registry.digitalocean.com/interviewai/api:latest
          docker push registry.digitalocean.com/interviewai/api:latest

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/interviewai
            docker-compose pull
            docker-compose up -d
            docker system prune -f
```

---

## 11. Monitoring and Logging

### 11.1 Application Monitoring

```typescript
// Winston logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Metrics to track
interface ApplicationMetrics {
  requestsPerSecond: number;
  averageResponseTime: number;
  errorRate: number;
  activeUsers: number;
  databaseConnections: number;
  cacheHitRate: number;
  queueLength: number;
  aiApiLatency: number;
}
```

### 11.2 Health Checks

```typescript
// Health check endpoint
@Get('health')
async healthCheck(): Promise<HealthStatus> {
  return {
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
    checks: {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      openai: await this.checkOpenAI(),
      stripe: await this.checkStripe()
    }
  };
}
```

---

## Conclusion

This technical specification provides a comprehensive foundation for building InterviewAI Pro. All requirements are production-ready and follow senior-level software engineering best practices.

**Next Steps:**
1. Review and approve this TZ
2. Set up development environment
3. Create detailed task breakdown
4. Begin sprint planning

**Document Control:**
- Version: 1.0.0
- Status: Draft
- Last Updated: November 2025
- Next Review: After technical architecture approval

---
**END OF TECHNICAL SPECIFICATION**
