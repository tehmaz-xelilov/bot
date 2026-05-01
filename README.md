# WhatsApp-Telegram Bridge Bot

Professional WhatsApp-Telegram bridge bot. WhatsApp mesajlarını Telegram-a yönləndirir və Telegram-dan cavab yazmağa imkan verir.

## ✨ Xüsusiyyətlər

- **WhatsApp → Telegram**: Bütün gələn mesajlar (mətn, şəkil, video, audio, səsli mesaj) Telegram-a yönləndirilir
- **Telegram → WhatsApp**: Admin Telegram-dan cavab yazaraq WhatsApp-a mesaj göndərə bilər
- **Voice Transcription**: OpenAI Whisper ilə səsli mesajları mətnə çevirir (optional)
- **Admin Commands**: Bot idarəsi üçün müxtəlif komandalar
- **Logging**: Winston logger ilə professional log sistemi
- **Auto-restart**: Xəta zamanı avtomatik yenidən başlanma
- **Statistics**: Detallı bot statistikası

## Buludda (Railway/Render/Docker) Quraşdırma

1. Bu layihəni öz GitHub hesabınıza yükləyin (Private repo tövsiyə olunur).
2. [Railway.app](https://railway.app/) və ya [Render](https://render.com/) saytında yeni layihə yaradın və GitHub reposunu bağlayın.
3. **Variables** bölməsində aşağıdakı dəyişənləri əlavə edin:
   - `TELEGRAM_TOKEN`: Sizin BotFather-dən aldığınız token
   - `TELEGRAM_ADMIN_ID`: Sizin Telegram ID-niz
   - `OPENAI_API_KEY` (optional): Voice transcription üçün OpenAI API key
   - `LOG_LEVEL` (optional): `info`, `debug`, `error` (default: `info`)
   - `NODE_ENV` (optional): `production` və ya `development`
4. Bot avtomatik işə düşəcək. İlk dəfə işə düşəndə Telegram-dan QR kodu skan etməlisiniz.

## Mühit Dəyişənləri (Environment Variables)

| Dəyişən | Təsvir | Zəruri |
| :--- | :--- | :--- |
| `TELEGRAM_TOKEN` | Telegram Bot Token | ✅ |
| `TELEGRAM_ADMIN_ID` | Sizin Telegram Chat ID | ✅ |
| `OPENAI_API_KEY` | OpenAI API Key (voice transcription üçün) | ❌ |
| `LOG_LEVEL` | Log level (`info`, `debug`, `error`) | ❌ |
| `NODE_ENV` | Environment (`production`, `development`) | ❌ |

## Admin Komandaları

| Komanda | Təsvir |
| :--- | :--- |
| `/status` | Bot vəziyyəti və statistika |
| `/help` | Komandalar siyahısı |
| `/restart` | Botu yenidən başlat |
| `/logout` | WhatsApp session sil |
| `/stats` | Detallı statistika |
| `/clear` | Message map təmizlə |

## Yerli (Local) İşlətmə

1. `npm install`
2. `npm start`

## Docker ilə İşlətmə

1. `docker build -t whatsapp-bridge .`
2. `docker run -e TELEGRAM_TOKEN=your_token -e TELEGRAM_ADMIN_ID=your_id whatsapp-bridge`

## PM2 ilə İşlətmə

1. `npm install -g pm2`
2. `pm2 start ecosystem.config.js`
3. `pm2 logs whatsapp-bridge`
4. `pm2 monit`

## Fayl Strukturu

```
.
├── bot.js                 # Əsas bot faylı
├── package.json           # Dependencies
├── Dockerfile             # Docker konfiqurasiyası
├── ecosystem.config.js    # PM2 konfiqurasiyası
├── README.md              # Bu fayl
├── logs/                  # Log faylları (avtomatik yaranır)
├── tmp/                   # Temp fayllar (avtomatik yaranır)
└── .wwebjs_auth/          # WhatsApp session (avtomatik yaranır)
```

## Qeydlər

- Bot yalnız admin tərəfindən istifadə oluna bilər
- Voice transcription üçün `OPENAI_API_KEY` tələb olunur
- Railway/Render-də deploy edərkən `ffmpeg` avtomatik quraşdırılır
- Bot xəta zamanı avtomatik yenidən başlanır
