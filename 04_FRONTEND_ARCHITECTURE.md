# InterviewAI Pro - Frontend Architecture

## Document Information
- **Component:** Frontend Web Application
- **Framework:** React 18 + TypeScript
- **Styling:** TailwindCSS + shadcn/ui
- **Build Tool:** Vite
- **Version:** 1.0.0
- **Last Updated:** November 2025

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Project Structure](#2-project-structure)
3. [State Management](#3-state-management)
4. [Routing](#4-routing)
5. [API Integration](#5-api-integration)
6. [UI Components](#6-ui-components)
7. [Forms and Validation](#7-forms-and-validation)
8. [Authentication Flow](#8-authentication-flow)
9. [Performance Optimization](#9-performance-optimization)
10. [Build and Deployment](#10-build-and-deployment)

---

## 1. Technology Stack

```json
{
  "framework": "React 18.2",
  "language": "TypeScript 5.x",
  "buildTool": "Vite 5.x",
  "styling": {
    "css": "TailwindCSS 3.x",
    "components": "shadcn/ui",
    "icons": "lucide-react"
  },
  "stateManagement": {
    "global": "Zustand",
    "server": "TanStack Query (React Query)",
    "forms": "React Hook Form"
  },
  "routing": "React Router v6",
  "validation": "Zod",
  "http": "Axios",
  "charts": "Recharts",
  "animations": "Framer Motion"
}
```

---

## 2. Project Structure

```
frontend/
├── public/
│   ├── favicon.ico
│   └── robots.txt
│
├── src/
│   ├── main.tsx                     # Application entry point
│   ├── App.tsx                      # Root component
│   ├── vite-env.d.ts
│   │
│   ├── assets/                      # Static assets
│   │   ├── images/
│   │   ├── icons/
│   │   └── fonts/
│   │
│   ├── components/                  # Reusable components
│   │   ├── ui/                      # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── select.tsx
│   │   │   ├── textarea.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── progress.tsx
│   │   │   └── skeleton.tsx
│   │   │
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── DashboardLayout.tsx
│   │   │   └── AuthLayout.tsx
│   │   │
│   │   ├── common/
│   │   │   ├── LoadingSpinner.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── ProtectedRoute.tsx
│   │   │   ├── SEO.tsx
│   │   │   └── PageTransition.tsx
│   │   │
│   │   └── features/                # Feature-specific components
│   │       ├── auth/
│   │       │   ├── LoginForm.tsx
│   │       │   ├── RegisterForm.tsx
│   │       │   └── ForgotPasswordForm.tsx
│   │       │
│   │       ├── cv/
│   │       │   ├── CVUpload.tsx
│   │       │   ├── CVAnalysisCard.tsx
│   │       │   ├── CVOptimizer.tsx
│   │       │   └── CVPreview.tsx
│   │       │
│   │       ├── interview/
│   │       │   ├── InterviewSetup.tsx
│   │       │   ├── InterviewSession.tsx
│   │       │   ├── QuestionCard.tsx
│   │       │   ├── AnswerRecorder.tsx
│   │       │   ├── FeedbackPanel.tsx
│   │       │   └── SessionHistory.tsx
│   │       │
│   │       ├── dashboard/
│   │       │   ├── StatsCard.tsx
│   │       │   ├── RecentActivity.tsx
│   │       │   ├── UsageChart.tsx
│   │       │   └── QuickActions.tsx
│   │       │
│   │       └── profile/
│   │           ├── ProfileSettings.tsx
│   │           ├── SubscriptionCard.tsx
│   │           ├── UsageStats.tsx
│   │           └── NotificationSettings.tsx
│   │
│   ├── pages/                       # Page components
│   │   ├── HomePage.tsx
│   │   ├── LoginPage.tsx
│   │   ├── RegisterPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── CVPage.tsx
│   │   ├── InterviewPage.tsx
│   │   ├── InterviewSessionPage.tsx
│   │   ├── ProfilePage.tsx
│   │   ├── SubscriptionPage.tsx
│   │   ├── AnalyticsPage.tsx
│   │   ├── NotFoundPage.tsx
│   │   └── ErrorPage.tsx
│   │
│   ├── hooks/                       # Custom React hooks
│   │   ├── useAuth.ts
│   │   ├── useUser.ts
│   │   ├── useCV.ts
│   │   ├── useInterview.ts
│   │   ├── useWebSocket.ts
│   │   ├── useAudioRecorder.ts
│   │   ├── useLocalStorage.ts
│   │   ├── useDebounce.ts
│   │   └── useMediaQuery.ts
│   │
│   ├── store/                       # Zustand stores
│   │   ├── authStore.ts
│   │   ├── userStore.ts
│   │   ├── cvStore.ts
│   │   ├── interviewStore.ts
│   │   └── uiStore.ts
│   │
│   ├── services/                    # API services
│   │   ├── api.ts                   # Axios instance
│   │   ├── authService.ts
│   │   ├── userService.ts
│   │   ├── cvService.ts
│   │   ├── interviewService.ts
│   │   ├── aiService.ts
│   │   └── websocketService.ts
│   │
│   ├── lib/                         # Utility functions
│   │   ├── utils.ts
│   │   ├── cn.ts                    # Class name utility
│   │   ├── formatters.ts
│   │   ├── validators.ts
│   │   └── constants.ts
│   │
│   ├── types/                       # TypeScript type definitions
│   │   ├── api.types.ts
│   │   ├── user.types.ts
│   │   ├── cv.types.ts
│   │   ├── interview.types.ts
│   │   └── common.types.ts
│   │
│   ├── styles/                      # Global styles
│   │   ├── globals.css
│   │   └── tailwind.css
│   │
│   └── config/                      # Configuration files
│       ├── routes.tsx
│       ├── env.ts
│       └── constants.ts
│
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── .env.example
├── .env.development
├── .env.production
└── README.md
```

---

## 3. State Management

### 3.1 Zustand Store Implementation

```typescript
// src/store/authStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatar?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  
  // Actions
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
        }),

      clearAuth: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        }),

      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        refreshToken: state.refreshToken,
      }),
    }
  )
);
```

```typescript
// src/store/interviewStore.ts
import { create } from 'zustand';

interface Question {
  id: string;
  question: string;
  category: string;
  answer?: string;
}

interface InterviewState {
  sessionId: string | null;
  currentQuestionIndex: number;
  questions: Question[];
  isRecording: boolean;
  
  // Actions
  setSession: (sessionId: string, questions: Question[]) => void;
  nextQuestion: () => void;
  previousQuestion: () => void;
  submitAnswer: (questionId: string, answer: string) => void;
  setRecording: (isRecording: boolean) => void;
  resetSession: () => void;
}

export const useInterviewStore = create<InterviewState>((set) => ({
  sessionId: null,
  currentQuestionIndex: 0,
  questions: [],
  isRecording: false,

  setSession: (sessionId, questions) =>
    set({
      sessionId,
      questions,
      currentQuestionIndex: 0,
    }),

  nextQuestion: () =>
    set((state) => ({
      currentQuestionIndex: Math.min(
        state.currentQuestionIndex + 1,
        state.questions.length - 1
      ),
    })),

  previousQuestion: () =>
    set((state) => ({
      currentQuestionIndex: Math.max(state.currentQuestionIndex - 1, 0),
    })),

  submitAnswer: (questionId, answer) =>
    set((state) => ({
      questions: state.questions.map((q) =>
        q.id === questionId ? { ...q, answer } : q
      ),
    })),

  setRecording: (isRecording) => set({ isRecording }),

  resetSession: () =>
    set({
      sessionId: null,
      currentQuestionIndex: 0,
      questions: [],
      isRecording: false,
    }),
}));
```

### 3.2 React Query Setup

```typescript
// src/services/api.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';
import { toast } from 'sonner';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken } = useAuthStore.getState();
    
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Handle 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const { refreshToken } = useAuthStore.getState();
        
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        // Refresh token
        const response = await axios.post(
          `${import.meta.env.VITE_API_URL}/auth/refresh`,
          { refreshToken }
        );

        const { accessToken } = response.data;
        
        // Update token in store
        useAuthStore.setState({ accessToken });

        // Retry original request
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Clear auth and redirect to login
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // Handle other errors
    if (error.response?.status === 429) {
      toast.error('Too many requests. Please try again later.');
    } else if (error.response?.status >= 500) {
      toast.error('Server error. Please try again later.');
    }

    return Promise.reject(error);
  }
);

export default api;
```

```typescript
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

---

## 4. Routing

```typescript
// src/config/routes.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';

import DashboardLayout from '../components/layout/DashboardLayout';
import AuthLayout from '../components/layout/AuthLayout';
import ProtectedRoute from '../components/common/ProtectedRoute';
import LoadingSpinner from '../components/common/LoadingSpinner';

// Lazy load pages
const HomePage = lazy(() => import('../pages/HomePage'));
const LoginPage = lazy(() => import('../pages/LoginPage'));
const RegisterPage = lazy(() => import('../pages/RegisterPage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const CVPage = lazy(() => import('../pages/CVPage'));
const InterviewPage = lazy(() => import('../pages/InterviewPage'));
const InterviewSessionPage = lazy(() => import('../pages/InterviewSessionPage'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const SubscriptionPage = lazy(() => import('../pages/SubscriptionPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));

const SuspenseWrapper = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <SuspenseWrapper>
        <HomePage />
      </SuspenseWrapper>
    ),
  },
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [
      {
        path: 'login',
        element: (
          <SuspenseWrapper>
            <LoginPage />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'register',
        element: (
          <SuspenseWrapper>
            <RegisterPage />
          </SuspenseWrapper>
        ),
      },
    ],
  },
  {
    path: '/app',
    element: (
      <ProtectedRoute>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/app/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: (
          <SuspenseWrapper>
            <DashboardPage />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'cv',
        element: (
          <SuspenseWrapper>
            <CVPage />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'interviews',
        element: (
          <SuspenseWrapper>
            <InterviewPage />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'interviews/:sessionId',
        element: (
          <SuspenseWrapper>
            <InterviewSessionPage />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'profile',
        element: (
          <SuspenseWrapper>
            <ProfilePage />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'subscription',
        element: (
          <SuspenseWrapper>
            <SubscriptionPage />
          </SuspenseWrapper>
        ),
      },
    ],
  },
  {
    path: '*',
    element: (
      <SuspenseWrapper>
        <NotFoundPage />
      </SuspenseWrapper>
    ),
  },
]);
```

```typescript
// src/components/common/ProtectedRoute.tsx
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  return <>{children}</>;
}
```

---

## 5. API Integration

```typescript
// src/services/authService.ts
import api from './api';
import { LoginDto, RegisterDto, AuthResponse } from '../types/api.types';

export const authService = {
  login: async (data: LoginDto): Promise<AuthResponse> => {
    const response = await api.post('/auth/login', data);
    return response.data;
  },

  register: async (data: RegisterDto): Promise<AuthResponse> => {
    const response = await api.post('/auth/register', data);
    return response.data;
  },

  refresh: async (refreshToken: string): Promise<AuthResponse> => {
    const response = await api.post('/auth/refresh', { refreshToken });
    return response.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
  },
};
```

```typescript
// src/hooks/useAuth.ts
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { authService } from '../services/authService';
import { useAuthStore } from '../store/authStore';
import { LoginDto, RegisterDto } from '../types/api.types';

export function useLogin() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  return useMutation({
    mutationFn: (data: LoginDto) => authService.login(data),
    onSuccess: (response) => {
      setAuth(response.user, response.accessToken, response.refreshToken);
      toast.success('Login successful!');
      navigate('/app/dashboard');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Login failed');
    },
  });
}

export function useRegister() {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (data: RegisterDto) => authService.register(data),
    onSuccess: () => {
      toast.success('Registration successful! Please check your email.');
      navigate('/auth/login');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Registration failed');
    },
  });
}

export function useLogout() {
  const navigate = useNavigate();
  const clearAuth = useAuthStore((state) => state.clearAuth);

  return useMutation({
    mutationFn: () => authService.logout(),
    onSuccess: () => {
      clearAuth();
      toast.success('Logged out successfully');
      navigate('/');
    },
  });
}
```

```typescript
// src/hooks/useCV.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { cvService } from '../services/cvService';

export function useUserCVs() {
  return useQuery({
    queryKey: ['cvs'],
    queryFn: () => cvService.getUserCVs(),
  });
}

export function useCV(cvId: string) {
  return useQuery({
    queryKey: ['cv', cvId],
    queryFn: () => cvService.getCV(cvId),
    enabled: !!cvId,
  });
}

export function useUploadCV() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, jobDescription }: { file: File; jobDescription?: string }) =>
      cvService.uploadCV(file, jobDescription),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cvs'] });
      toast.success('CV uploaded successfully! Analysis in progress...');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'CV upload failed');
    },
  });
}

export function useDeleteCV() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cvId: string) => cvService.deleteCV(cvId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cvs'] });
      toast.success('CV deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete CV');
    },
  });
}
```

---

## 6. UI Components

### 6.1 shadcn/ui Configuration

```typescript
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
```

```css
/* src/styles/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

### 6.2 Example Feature Component

```typescript
// src/components/features/cv/CVUpload.tsx
import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, X } from 'lucide-react';

import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Textarea } from '../../ui/textarea';
import { Label } from '../../ui/label';
import { Progress } from '../../ui/progress';
import { useUploadCV } from '../../../hooks/useCV';

export default function CVUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  
  const uploadCV = useUploadCV();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
    },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024, // 5MB
  });

  const handleUpload = () => {
    if (!file) return;
    uploadCV.mutate({ file, jobDescription: jobDescription || undefined });
  };

  const handleRemoveFile = () => {
    setFile(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Your CV/Resume</CardTitle>
        <CardDescription>
          Upload your CV for AI-powered analysis and optimization
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!file ? (
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
              transition-colors
              ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
              hover:border-primary hover:bg-primary/5
            `}
          >
            <input {...getInputProps()} />
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-sm text-muted-foreground">Drop your CV here...</p>
            ) : (
              <>
                <p className="text-sm font-medium mb-1">
                  Drag and drop your CV here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  Supported formats: PDF, DOCX, TXT (Max 5MB)
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-primary" />
              <div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemoveFile}
              disabled={uploadCV.isPending}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="jobDescription">
            Job Description (Optional)
          </Label>
          <Textarea
            id="jobDescription"
            placeholder="Paste the job description here for tailored analysis..."
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            rows={6}
            disabled={uploadCV.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Adding a job description helps our AI provide more targeted suggestions
          </p>
        </div>

        {uploadCV.isPending && (
          <div className="space-y-2">
            <Progress value={33} />
            <p className="text-sm text-center text-muted-foreground">
              Uploading and analyzing your CV...
            </p>
          </div>
        )}

        <Button
          onClick={handleUpload}
          disabled={!file || uploadCV.isPending}
          className="w-full"
        >
          {uploadCV.isPending ? 'Analyzing...' : 'Upload and Analyze'}
        </Button>
      </CardContent>
    </Card>
  );
}
```

---

## 7. Forms and Validation

```typescript
// src/components/features/auth/LoginForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Link } from 'react-router-dom';

import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { useLogin } from '../../../hooks/useAuth';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginForm() {
  const login = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = (data: LoginFormData) => {
    login.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="your@email.com"
          {...register('email')}
          disabled={isSubmitting}
        />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            to="/auth/forgot-password"
            className="text-sm text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          placeholder="••••••••"
          {...register('password')}
          disabled={isSubmitting}
        />
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        )}
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || login.isPending}
      >
        {isSubmitting || login.isPending ? 'Logging in...' : 'Log in'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <Link to="/auth/register" className="text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
```

---

## 8. Authentication Flow

```typescript
// src/App.tsx
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useEffect } from 'react';

import { router } from './config/routes';
import { useAuthStore } from './store/authStore';
import { authService } from './services/authService';

function App() {
  const { refreshToken, setAuth, clearAuth } = useAuthStore();

  useEffect(() => {
    // Check if user has refresh token and refresh access token
    const initAuth = async () => {
      if (refreshToken) {
        try {
          const response = await authService.refresh(refreshToken);
          setAuth(response.user, response.accessToken, response.refreshToken);
        } catch (error) {
          clearAuth();
        }
      }
    };

    initAuth();
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      <Toaster position="top-right" richColors />
    </>
  );
}

export default App;
```

---

## 9. Performance Optimization

```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Debounce hook
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Image lazy loading
export const lazyLoadImage = (src: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = reject;
    img.src = src;
  });
};
```

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          'query-vendor': ['@tanstack/react-query'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

---

## 10. Build and Deployment

```dockerfile
# Dockerfile.prod
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

```nginx
# nginx.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

---

**Document End**

This comprehensive frontend architecture document provides all necessary implementation details for building a production-ready React application with TypeScript, TailwindCSS, and shadcn/ui.
