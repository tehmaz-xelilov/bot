const { spawn } = require('child_process');

// Auto‑restart helper – spawns a new instance of this script and exits the current process.
function autoRestart() {
    try {
        const child = spawn(process.argv[0], process.argv.slice(1), {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
    } catch (e) {
        console.error('Restart xətası:', e.message);
    }
    process.exit(0);
}

const TelegramBot = require('node-telegram-bot-api');

// Konfiqurasiya
const token = process.env.TELEGRAM_TOKEN;
const adminId = process.env.TELEGRAM_ADMIN_ID;

const telegram = new TelegramBot(token, { polling: true });
const whatsapp = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

// QR Kod
whatsapp.on('qr', (qr) => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    telegram.sendPhoto(adminId, qrUrl, { caption: 'WhatsApp QR kodunu skan edin.' });
});

// Hazır olanda
whatsapp.on('ready', () => {
    telegram.sendMessage(adminId, '✅ Bot aktivdir. Mesajlar bura gələcək.');
});

// Mesaj Ötürülməsi (Ən sadə forma)
whatsapp.on('message', async (msg) => {
    if (msg.fromMe) return;

    try {
        const contact = await msg.getContact();
        const name = contact.pushname || contact.name || 'Bilinməyən';
        const from = msg.from.split('@')[0];
        
        // Sadəcə mətn (Markdown istifadə olunmur ki, xəta verməsin)
        const report = `👤 ${name} (${from})\n\n${msg.body || '[Media]'}`;
        await telegram.sendMessage(adminId, report);

        // Media varsa göndər
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                const buffer = Buffer.from(media.data, 'base64');
                if (msg.type === 'image') await telegram.sendPhoto(adminId, buffer);
                else if (msg.type === 'video') await telegram.sendVideo(adminId, buffer);
                else if (msg.type === 'audio' || msg.type === 'ptt') await telegram.sendAudio(adminId, buffer);
                else await telegram.sendDocument(adminId, buffer, { filename: media.filename });
            }
        }
    } catch (e) {
        console.error('Xəta:', e.message);
    }
});

// Manual restart command (admin only)
telegram.onText(/\/restart/, (msg) => {
    if (msg.chat.id != adminId) return;
    telegram.sendMessage(adminId, '🔄 Bot yenidən başladılır...').catch(() => {});
    autoRestart();
});

// Stabillik üçün – avtomatik yenidən başla
process.on('uncaughtException', (err) => {
    console.error('Kritik xəta:', err.message);
    autoRestart();
});

whatsapp.initialize();
