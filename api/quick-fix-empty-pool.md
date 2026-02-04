# 🚨 QUICK FIX: Empty Question Pool

## Problem
`/tasks` buyrug'i hech narsa ko'rsatmaydi chunki question pool bo'sh.

## Diagnostika

### 1. Server'ga SSH orqali kiring:
```bash
ssh root@YOUR_SERVER_IP
```

### 2. Project papkasiga o'ting:
```bash
cd /path/to/InterviewAI\ Pro/api
```

### 3. Diagnostic script'ni ishga tushiring:
```bash
# Umumiy diagnostika
node diagnose-daily-tasks.js

# Yoki ma'lum user uchun (Telegram ID bilan)
node diagnose-daily-tasks.js 1778261703
```

### 4. Output'ni o'qing va muammoni toping:
```
Agar ko'rsatsa:
❌ Question pool is EMPTY!
```

## Yechim 1: Pool'ni Avtomatik To'ldirish

### Variant A: API endpoint orqali (TEZROQ)
```bash
# Server ichida:
curl -X POST http://localhost:3000/debug/trigger-pool-refill

# Yoki tashqaridan:
curl -X POST https://interviewai.pro/debug/trigger-pool-refill
```

**Kutish vaqti:** 10-15 daqiqa (2600 savol generatsiya bo'ladi)

### Variant B: PM2 logs orqali kuzatish
```bash
# Pool refill jarayonini kuzatish
pm2 logs api --lines 100 | grep -i "pool"

# Output:
# [QuestionPoolManager] 🔄 Starting question pool refill...
# [QuestionPoolManager] ✅ Generated 10 questions for junior/technical/frontend
# ...
```

## Yechim 2: Manual Daily Delivery Trigger

Agar pool to'ldirilgan bo'lsa lekin bugungi task'lar yo'q bo'lsa:

```bash
# Daily delivery'ni qo'lda ishga tushirish
curl -X POST http://localhost:3000/debug/trigger-daily-tasks
```

## Yechim 3: Pool Statusini Tekshirish

```bash
# Pool status
curl http://localhost:3000/debug/question-pool-status

# Output:
{
  "success": true,
  "stats": [...],
  "summary": {
    "total": 2600,
    "healthy": 26,
    "warning": 0
  }
}
```

## Verification (Tekshirish)

### 1. Database'da tekshirish:
```bash
# MongoDB'ga kiring
docker exec -it mongodb mongosh -u interview9854 -p inter9986 --authenticationDatabase admin

# Question pool'ni hisoblash
use interviewai
db.generated_questions.countDocuments()
# Output: 2600 (yoki ko'proq) bo'lishi kerak

# Bugungi daily tasks
db.daily_tasks.countDocuments({ 
  date: { 
    $gte: new Date(new Date().setHours(0,0,0,0)) 
  } 
})
# Output: 0 dan katta bo'lishi kerak
```

### 2. User bilan test qilish:
```bash
# Telegram bot'da:
# 1. /tasks buyrug'ini yuboring
# 2. "Bugungi vazifalar" tugmasini bosing
# 3. 3 ta task ko'rinishi kerak ✅
```

## Troubleshooting

### Issue 1: Pool to'ldirilmayapti
**Belgilari:**
```
curl -X POST http://localhost:3000/debug/trigger-pool-refill
# Response: timeout yoki error
```

**Yechim:**
```bash
# API logs'ni tekshirish
pm2 logs api --lines 200

# OPENAI_API_KEY borligini tekshirish
echo $OPENAI_API_KEY
# Yoki
grep OPENAI_API_KEY .env

# Agar yo'q bo'lsa, .env'ga qo'shing:
OPENAI_API_KEY=sk-or-v1-...
```

### Issue 2: Daily tasks yaratilmayapti
**Belgilari:**
```bash
curl http://localhost:3000/debug/question-pool-status
# Output: total: 2600 ✅

node diagnose-daily-tasks.js
# Output: Total daily tasks created today: 0 ❌
```

**Yechim:**
```bash
# Cron job ishlayotganini tekshirish
pm2 logs api --lines 500 | grep "deliverDailyTasks"

# Agar log bo'sh bo'lsa, cron ishlamayapti
# Server vaqtini tekshirish
date
# TZ=Asia/Tashkent date

# Manual trigger:
curl -X POST http://localhost:3000/debug/trigger-daily-tasks
```

### Issue 3: User task olayapti lekin ko'rinmayapti
**Belgilari:**
```bash
node diagnose-daily-tasks.js 1778261703
# Output: ✅ User has daily tasks today! ✅
# But Telegram shows: "Hech qanday vazifa topilmadi"
```

**Yechim:**
Bu Telegram bot logic'dagi muammo. Quyidagini tekshiring:

```bash
# telegram-commands.service.ts'dagi /tasks handler'ni tekshiring
pm2 logs api --lines 100 | grep "/tasks"

# Agar error ko'rsatsa, code'ni qayta ko'rib chiqish kerak
```

## Expected Timeline

| Qadam | Vaqt |
|-------|------|
| 1. Diagnostic script ishga tushirish | 10 soniya |
| 2. Pool refill trigger qilish | 1 daqiqa |
| 3. Pool to'ldirilishini kutish | 10-15 daqiqa |
| 4. Daily delivery trigger | 1 daqiqa |
| 5. User test qilish | 1 daqiqa |
| **JAMI** | **~20 daqiqa** |

## Emergency Rollback

Agar hamma narsa ishlamasa:

```bash
# 1. Oldingi versiyaga qaytish
cd /path/to/InterviewAI\ Pro
git log --oneline -5
# Oxirgi ishlaydigan commit'ni toping

git checkout <commit-hash>

# 2. Rebuild & restart
cd api
npm install
npm run build
pm2 restart all
```

## Success Criteria

✅ Pool status: total > 0  
✅ Today's tasks: count > 0  
✅ User clicks /tasks → sees tasks  
✅ User can answer tasks  
✅ No errors in logs  

---

**Last Updated:** 2025-02-04  
**Next Review:** After fix is deployed
