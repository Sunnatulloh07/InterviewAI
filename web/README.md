# InterviewAI Pro - Web Application

Next.js web application for InterviewAI Pro platform, integrated with Telegram Web App.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui (New York style)
- **State Management**: Zustand
- **Forms**: React Hook Form + Zod
- **HTTP Client**: Axios
- **Icons**: Lucide React

## Features

- ✅ Telegram Web App integration
- ✅ Authentication with JWT tokens
- ✅ Responsive design
- ✅ Dark mode support
- ✅ Multi-language support (UZ, RU, EN)

## Getting Started

### Prerequisites

- Node.js 20+
- Backend API running on port 3000

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Update .env.local with your configuration
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Development

```bash
# Start development server (runs on port 3001)
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

### Production Build

```bash
# Build for production
npm run build

# Start production server
npm start
```

## Project Structure

```
web/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx          # Root layout with Telegram Web App SDK
│   ├── page.tsx           # Home page
│   └── globals.css        # Global styles with Tailwind
├── components/             # React components
│   └── ui/                # shadcn/ui components
├── lib/                    # Utility functions
│   ├── api.ts             # Axios API client
│   ├── telegram-webapp.ts # Telegram Web App SDK wrapper
│   └── utils.ts           # Utility functions (cn, etc.)
├── store/                  # Zustand stores
│   ├── auth-store.ts      # Authentication state
│   └── ui-store.ts        # UI state (theme, sidebar, etc.)
└── public/                 # Static assets
```

## Telegram Web App Integration

The app is designed to work inside Telegram Web App. When opened from Telegram bot:

1. Telegram Web App SDK is automatically loaded
2. User data is extracted from Telegram
3. Theme matches Telegram's theme
4. Back button and main button are available

## API Integration

The app connects to the Nest.js backend API. Configure the API URL in `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Environment Variables

See `.env.example` for all available environment variables.

## License

Private - InterviewAI Pro
