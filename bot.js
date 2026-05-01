

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const fetch = require('node-fetch');
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
                // Voice message transcription
        telegram.on('voice', async (msg) => {
            const chatId = msg.chat.id;
            try {
                // Download voice file
                const file = await telegram.getFile(msg.voice.file_id);
                const filePath = `tmp/${msg.voice.file_id}.ogg`;
                await telegram.downloadFile(file.file_path, filePath);
                
                // Convert OGG to WAV using ffmpeg (requires ffmpeg installed)
                const wavPath = `tmp/${msg.voice.file_id}.wav`;

                execSync(`ffmpeg -y -i "${filePath}" "${wavPath}"`);
                
                // Send to Whisper (OpenAI) for transcription


                const audioData = require('fs').readFileSync(wavPath);
                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: new URLSearchParams({
                        file: audioData,
                        model: 'whisper-1',
                    })
                });
                const result = await response.json();
                const transcription = result.text || 'Transcription failed.';
                await telegram.sendMessage(chatId, `🗣️ Səsli mesajın mətn: ${transcription}`);
            } catch (e) {
                console.error('Səsli mesajın transkripsiyası zamanı xəta:', e.message);
            }
        });
// Voice message transcription
telegram.on('voice', async (msg) => {
    const chatId = msg.chat.id;
    try {
        // Ensure tmp directory exists
        const tmpDir = path.join(__dirname, 'tmp');
        fs.mkdirSync(tmpDir, { recursive: true });
        const file = await telegram.getFile(msg.voice.file_id);
        const oggPath = path.join(tmpDir, `${msg.voice.file_id}.ogg`);
        const wavPath = path.join(tmpDir, `${msg.voice.file_id}.wav`);
        await telegram.downloadFile(file.file_path, oggPath);
        execSync(`ffmpeg -y -i "${oggPath}" "${wavPath}"`);
        const audioData = fs.readFileSync(wavPath);
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: new URLSearchParams({
                file: audioData,
                model: 'whisper-1'
            })
        });
        const result = await response.json();
        const transcription = result.text || 'Transcription failed.';
        await telegram.sendMessage(chatId, `🗣️ Səsli mesajın mətn: ${transcription}`);
    } catch (e) {
        console.error('Səsli mesajın transkripsiyası zamanı xəta:', e.message);
    }
});
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
