# WhatsApp-Telegram Bridge Bot

Bu bot WhatsApp mesajlarını Telegram-a yönləndirir və Telegram-dan cavab yazmağa imkan verir.

## Buludda (Railway/Render) Quraşdırma

1.  Bu layihəni öz GitHub hesabınıza yükləyin (Private repo tövsiyə olunur).
2.  [Railway.app](https://railway.app/) saytında yeni layihə yaradın və GitHub reposunu bağlayın.
3.  **Variables** bölməsində aşağıdakı dəyişənləri əlavə edin:
    *   `TELEGRAM_TOKEN`: Sizin BotFather-dən aldığınız token.
    *   `TELEGRAM_ADMIN_ID`: Sizin Telegram ID-niz.
4.  Bot avtomatik işə düşəcək. Telegram-da botunuza `/status` yazaraq yoxlaya bilərsiniz.
5.  İlk dəfə işə düşəndə terminaldan (və ya Telegram-dan) QR kodu skan etməlisiniz.

## Mühit Dəyişənləri (Environment Variables)

| Dəyişən | Təsvir |
| :--- | :--- |
| `TELEGRAM_TOKEN` | Telegram Bot Token |
| `TELEGRAM_ADMIN_ID` | Sizin Telegram Chat ID |
| `AUTO_REPLIER` | `true` və ya `false` (Avtomatik cavab) |
| `REPLIER_MESSAGE` | Avtomatik cavab mətni |
| `DEBUG_MODE` | `true` (Ətraflı loqlar üçün) |

## Yerli (Local) İşlətmə

1. `npm install`
2. `node bridge.js`
