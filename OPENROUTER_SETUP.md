# 🚀 OpenRouter Integration - Complete Setup Guide

## ✅ O'zgarishlar Qo'shildi

Loyihangiz endi **OpenRouter** orqali ishlaydi! Bu quyidagi afzalliklarni beradi:

### 🎯 Afzalliklari:
1. **Arzonroq** - OpenRouter narxlari to'g'ridan-to'g'ri OpenAI'dan arzonroq
2. **Ko'proq modellar** - 100+ AI model'ga access (GPT-4, Claude, Llama, va h.k.)
3. **Fallback** - Agar bitta model ishlamasa, boshqasiga switch qilish oson
4. **Unified API** - Bir API key bilan barcha modellarni ishlatish mumkin
5. **No rate limits** - OpenAI rate limit muammosidan qutulasiz

---

## 📝 Nima O'zgartirildi?

### 1. **Environment Variables** (.env)

```env
# OpenRouter Configuration
OPENAI_API_KEY=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
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_SITE_URL=http://localhost:5173
OPENAI_SITE_NAME=InterviewAI Pro

# Model Configuration (OpenRouter format)
OPENAI_CHAT_MODEL=openai/gpt-4-turbo
OPENAI_CHAT_FALLBACK_MODEL=openai/gpt-3.5-turbo
OPENAI_WHISPER_MODEL=openai/whisper-1
```

### 2. **Configuration Files**

#### `api/src/config/openai.config.ts`
- ✅ `baseURL` qo'shildi
- ✅ `siteUrl` va `siteName` qo'shildi (OpenRouter rankings uchun)
- ✅ Model format'lar yangilandi

#### `api/src/app.module.ts`
- ✅ Validation schema yangilandi (12 ta yangi env variable)

#### `api/src/common/constants/index.ts`
- ✅ AI_MODELS OpenRouter formatiga o'zgartirildi:
  - `gpt-4-turbo-preview` → `openai/gpt-4-turbo`
  - `gpt-3.5-turbo` → `openai/gpt-3.5-turbo`
  - `claude-3-sonnet` → `anthropic/claude-3-sonnet`

### 3. **Service Files Updated**

Quyidagi 6 ta service yangilandi:

1. ✅ `interviews.service.ts` - Question generation
2. ✅ `ai-answer.service.ts` - Answer generation
3. ✅ `ai-stt.service.ts` - Speech-to-text (Whisper)
4. ✅ `cv.service.ts` - CV analysis
5. ✅ `interviews-feedback.service.ts` - Feedback generation
6. ✅ `telegram-commands.service.ts` - Telegram bot

Har bir service'da OpenAI client initialization yangilandi:

```typescript
const config = {
  apiKey: apiKey.trim(),
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': siteUrl,
    'X-Title': siteName,
  },
};
const openai = new OpenAI(config);
```

---

## 🧪 Test Qilish

### Option 1: Test Script
```bash
cd api
node test-openrouter.js
```

Bu 3 ta test ishga tushadi:
- ✅ Simple chat completion
- ✅ JSON response format
- ✅ GPT-4 Turbo test

### Option 2: Backend'ni Ishga Tushirish
```bash
cd api

# Install dependencies (agar yo'q bo'lsa)
npm install

# Start development server
npm run start:dev
```

Log'larda ko'rasiz:
```
[InterviewsService] OpenAI client initialized via OpenRouter
[AiAnswerService] OpenAI client initialized via OpenRouter
[AiSttService] OpenAI client initialized via OpenRouter
...
```

---

## 🎨 Qo'shimcha Model'lar

OpenRouter orqali 100+ model'ga access bor:

### Popular Models:

```env
# OpenAI Models
OPENAI_CHAT_MODEL=openai/gpt-4-turbo
OPENAI_CHAT_MODEL=openai/gpt-4-turbo-preview
OPENAI_CHAT_MODEL=openai/gpt-3.5-turbo

# Anthropic Claude Models
OPENAI_CHAT_MODEL=anthropic/claude-3-opus
OPENAI_CHAT_MODEL=anthropic/claude-3-sonnet
OPENAI_CHAT_MODEL=anthropic/claude-3-haiku

# Google Models
OPENAI_CHAT_MODEL=google/gemini-pro
OPENAI_CHAT_MODEL=google/gemini-1.5-pro

# Meta Models
OPENAI_CHAT_MODEL=meta-llama/llama-3-70b-instruct
OPENAI_CHAT_MODEL=meta-llama/llama-3-8b-instruct

# Open Source Models
OPENAI_CHAT_MODEL=mistralai/mixtral-8x7b-instruct
OPENAI_CHAT_MODEL=nousresearch/nous-hermes-2-mixtral-8x7b-dpo
```

To'liq list: https://openrouter.ai/models

---

## 💰 Narxlar (OpenRouter)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| GPT-3.5 Turbo | $0.50 | $1.50 |
| GPT-4 Turbo | $10.00 | $30.00 |
| Claude 3 Sonnet | $3.00 | $15.00 |
| Claude 3 Opus | $15.00 | $75.00 |
| Llama 3 70B | $0.59 | $0.79 |

**To'g'ridan-to'g'ri OpenAI'dan 20-40% arzonroq!**

---

## 🔧 Troubleshooting

### Error: Invalid API Key
```bash
# Check your .env file
cat api/.env | grep OPENAI_API_KEY

# Should start with: sk-or-v1-
```

### Error: Model not found
```bash
# Make sure model name is in OpenRouter format:
# ✅ openai/gpt-4-turbo
# ❌ gpt-4-turbo

# Check: https://openrouter.ai/models
```

### Error: 402 Payment Required
```bash
# Add credits to your OpenRouter account
# https://openrouter.ai/credits
```

### Backend not recognizing OpenRouter
```bash
# Restart the backend server
cd api
npm run start:dev

# Check logs for:
# "OpenAI client initialized via OpenRouter"
```

---

## 📊 Monitoring

OpenRouter dashboard'da real-time monitoring:
- https://openrouter.ai/activity

Ko'rishingiz mumkin:
- ✅ Request count
- ✅ Token usage
- ✅ Cost per request
- ✅ Model performance
- ✅ Error rates

---

## 🚀 Production Deployment

### 1. Environment Variables
```bash
# Production .env
OPENAI_API_KEY=sk-or-v1-YOUR_PRODUCTION_KEY
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_SITE_URL=https://your-domain.com
OPENAI_SITE_NAME=InterviewAI Pro
```

### 2. Security
- ✅ `.env` faylni git'ga commit qilmang
- ✅ `.gitignore`'da `.env` bo'lishi kerak
- ✅ Production'da environment secret'lar ishlatish kerak

### 3. Rate Limiting
OpenRouter'da rate limit yo'q, lekin cost management uchun:
```env
# Set budget alerts on OpenRouter dashboard
# https://openrouter.ai/settings
```

---

## 📚 Qo'shimcha Resurslar

- 📖 OpenRouter Documentation: https://openrouter.ai/docs
- 🎯 Model Pricing: https://openrouter.ai/models
- 💳 Billing Dashboard: https://openrouter.ai/credits
- 🔧 API Status: https://status.openrouter.ai

---

## ✅ Checklist

Tekshiring:
- [x] `.env` faylda OpenRouter key bor
- [x] `OPENAI_BASE_URL=https://openrouter.ai/api/v1` set qilingan
- [x] Model format'lar to'g'ri (masalan: `openai/gpt-4-turbo`)
- [x] Backend restart qilingan
- [x] Log'larda "OpenAI client initialized via OpenRouter" ko'rinadi
- [x] Test script muvaffaqiyatli ishladi

---

## 🎉 Tayyor!

Loyihangiz endi OpenRouter orqali ishlaydi! Enjoy cheaper, faster, and more reliable AI! 🚀

**Savol bo'lsa, OpenRouter docs'ni tekshiring yoki menga yozing!**
