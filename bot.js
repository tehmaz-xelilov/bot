const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fetch = require('node-fetch');
const winston = require('winston');
const { Client, LocalAuth } = require('whatsapp-web.js');
const TelegramBot = require('node-telegram-bot-api');

// Logger konfiqurasiyası
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// Environment variables yoxlanışı
const requiredEnvVars = ['TELEGRAM_TOKEN', 'TELEGRAM_ADMIN_ID'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
}

// Konfiqurasiya
const token = process.env.TELEGRAM_TOKEN;
const adminId = process.env.TELEGRAM_ADMIN_ID;
const openaiApiKey = process.env.OPENAI_API_KEY;

const telegram = new TelegramBot(token, { polling: true });
const whatsapp = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

// Mesaj mapping - Telegram message ID -> WhatsApp chat ID
const messageMap = new Map();

// Bot statistikası
const stats = {
    whatsappMessages: 0,
    telegramMessages: 0,
    errors: 0,
    startTime: new Date()
};

// Auto‑restart helper – spawns a new instance of this script and exits the current process.
function autoRestart() {
    try {
        logger.info('Bot yenidən başladılır...');
        const child = spawn(process.argv[0], process.argv.slice(1), {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
    } catch (e) {
        logger.error('Restart xətası:', e.message);
    }
    process.exit(0);
}

// QR Kod
whatsapp.on('qr', (qr) => {
    logger.info('QR kod alındı');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    telegram.sendPhoto(adminId, qrUrl, { caption: 'WhatsApp QR kodunu skan edin.' })
        .catch(err => logger.error('QR kod göndərilərkən xəta:', err));
});

// Hazır olanda
whatsapp.on('ready', () => {
    logger.info('WhatsApp client hazırdır');
    telegram.sendMessage(adminId, '✅ Bot aktivdir. Mesajlar bura gələcək.')
        .catch(err => logger.error('Ready mesajı göndərilərkən xəta:', err));
});

// Authentication xətası
whatsapp.on('auth_failure', (msg) => {
    logger.error('Authentication xətası:', msg);
    telegram.sendMessage(adminId, '❌ WhatsApp authentication xətası: ' + msg)
        .catch(err => logger.error('Auth failure mesajı göndərilərkən xəta:', err));
});

// Client disconnected
whatsapp.on('disconnected', (reason) => {
    logger.warn('WhatsApp disconnected:', reason);
    telegram.sendMessage(adminId, '⚠️ WhatsApp disconnected: ' + reason)
        .catch(err => logger.error('Disconnected mesajı göndərilərkən xəta:', err));
});

// Mesaj Ötürülməsi (WhatsApp -> Telegram)
whatsapp.on('message', async (msg) => {
    if (msg.fromMe) return;

    try {
        stats.whatsappMessages++;
        const contact = await msg.getContact();
        const name = contact.pushname || contact.name || 'Bilinməyən';
        const from = msg.from.split('@')[0];
        
        // Sadəcə mətn
        const report = `👤 ${name} (${from})\n\n${msg.body || '[Media]'}`;
        const telegramMsg = await telegram.sendMessage(adminId, report);
        
        // Mapping saxla - cavab üçün
        messageMap.set(telegramMsg.message_id, msg.from);

        // Media varsa göndər
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                const buffer = Buffer.from(media.data, 'base64');
                let mediaMsg;
                if (msg.type === 'image') {
                    mediaMsg = await telegram.sendPhoto(adminId, buffer);
                } else if (msg.type === 'video') {
                    mediaMsg = await telegram.sendVideo(adminId, buffer);
                } else if (msg.type === 'audio' || msg.type === 'ptt') {
                    mediaMsg = await telegram.sendAudio(adminId, buffer);
                } else {
                    mediaMsg = await telegram.sendDocument(adminId, buffer, { filename: media.filename });
                }
                // Media üçün də mapping saxla
                if (mediaMsg) {
                    messageMap.set(mediaMsg.message_id, msg.from);
                }
            }
        }
        logger.info(`WhatsApp mesajı yönləndirildi: ${from}`);
    } catch (e) {
        stats.errors++;
        logger.error('WhatsApp mesajı emal edilərkən xəta:', e.message);
    }
});

// Telegram Voice Message Transcription (optional - requires form-data package)
// Note: To enable voice transcription, install form-data package: npm install form-data
// and uncomment the code below
/*
if (openaiApiKey) {
    const FormData = require('form-data');
    telegram.on('voice', async (msg) => {
        if (msg.chat.id != adminId) return;
        
        const chatId = msg.chat.id;
        try {
            const tmpDir = path.join(__dirname, 'tmp');
            fs.mkdirSync(tmpDir, { recursive: true });
            
            const file = await telegram.getFile(msg.voice.file_id);
            const oggPath = path.join(tmpDir, `${msg.voice.file_id}.ogg`);
            const wavPath = path.join(tmpDir, `${msg.voice.file_id}.wav`);
            await telegram.downloadFile(file.file_path, oggPath);
            
            execSync(`ffmpeg -y -i "${oggPath}" "${wavPath}"`);
            
            const formData = new FormData();
            formData.append('file', fs.createReadStream(wavPath));
            formData.append('model', 'whisper-1');
            
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    ...formData.getHeaders()
                },
                body: formData
            });
            
            const result = await response.json();
            const transcription = result.text || 'Transcription failed.';
            await telegram.sendMessage(chatId, `🗣️ Səsli mesajın mətn: ${transcription}`);
            
            fs.unlinkSync(oggPath);
            fs.unlinkSync(wavPath);
            
        } catch (e) {
            logger.error('Səsli mesajın transkripsiyası zamanı xəta:', e.message);
            await telegram.sendMessage(chatId, '❌ Transkripsiya xətası: ' + e.message);
        }
    });
} else {
    logger.warn('OPENAI_API_KEY təyin edilməyib, voice transcription deaktivdir');
}
*/

// Telegram-dan cavab (Admin only)
telegram.on('message', async (msg) => {
    if (msg.chat.id != adminId) return;
    if (msg.text && msg.text.startsWith('/')) return; // Commandları keç
    
    try {
        // Reply varsa, orijinal WhatsApp nömrəsini tap
        let targetNumber = null;
        
        if (msg.reply_to_message) {
            const replyId = msg.reply_to_message.message_id;
            targetNumber = messageMap.get(replyId);
        }
        
        // Əgər reply yoxdursa, son mesajı tap
        if (!targetNumber) {
            const mapEntries = Array.from(messageMap.entries());
            if (mapEntries.length > 0) {
                const lastEntry = mapEntries[mapEntries.length - 1];
                targetNumber = lastEntry[1];
            }
        }
        
        if (!targetNumber) {
            await telegram.sendMessage(adminId, '❌ Cavab veriləcək WhatsApp mesajı tapılmadı.');
            return;
        }
        
        stats.telegramMessages++;
        
        // Mətn mesajı
        if (msg.text) {
            await whatsapp.sendMessage(targetNumber + '@c.us', msg.text);
            await telegram.sendMessage(adminId, `✅ Mesaj göndərildi: ${targetNumber}`);
            logger.info(`Telegram mesajı WhatsApp-a göndərildi: ${targetNumber}`);
        }
        // Media mesajları
        else if (msg.photo) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const file = await telegram.getFile(fileId);
            const filePath = await telegram.downloadFile(file.file_path);
            await whatsapp.sendMessage(targetNumber + '@c.us', filePath, { caption: msg.caption || '' });
            await telegram.sendMessage(adminId, `✅ Şəkil göndərildi: ${targetNumber}`);
        }
        else if (msg.video) {
            const file = await telegram.getFile(msg.video.file_id);
            const filePath = await telegram.downloadFile(file.file_path);
            await whatsapp.sendMessage(targetNumber + '@c.us', filePath, { caption: msg.caption || '' });
            await telegram.sendMessage(adminId, `✅ Video göndərildi: ${targetNumber}`);
        }
        else if (msg.document) {
            const file = await telegram.getFile(msg.document.file_id);
            const filePath = await telegram.downloadFile(file.file_path);
            await whatsapp.sendMessage(targetNumber + '@c.us', filePath, { caption: msg.caption || '' });
            await telegram.sendMessage(adminId, `✅ Fayl göndərildi: ${targetNumber}`);
        }
        else if (msg.audio) {
            const file = await telegram.getFile(msg.audio.file_id);
            const filePath = await telegram.downloadFile(file.file_path);
            await whatsapp.sendMessage(targetNumber + '@c.us', filePath);
            await telegram.sendMessage(adminId, `✅ Audio göndərildi: ${targetNumber}`);
        }
        else if (msg.voice) {
            const file = await telegram.getFile(msg.voice.file_id);
            const filePath = await telegram.downloadFile(file.file_path);
            await whatsapp.sendMessage(targetNumber + '@c.us', filePath);
            await telegram.sendMessage(adminId, `✅ Səsli mesaj göndərildi: ${targetNumber}`);
        }
    } catch (e) {
        stats.errors++;
        logger.error('Telegram mesajı WhatsApp-a göndərilərkən xəta:', e.message);
        await telegram.sendMessage(adminId, '❌ Xəta: ' + e.message);
    }
});

// Admin Commands

// /status - Bot vəziyyəti
telegram.onText(/\/status/, async (msg) => {
    if (msg.chat.id != adminId) return;
    
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    const waStatus = whatsapp.info ? '✅ Connected' : '❌ Disconnected';
    
    const statusMsg = `
📊 **Bot Status**

⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s
📱 WhatsApp: ${waStatus}
📨 WhatsApp Messages: ${stats.whatsappMessages}
📤 Telegram Messages: ${stats.telegramMessages}
❌ Errors: ${stats.errors}
🚀 Started: ${stats.startTime.toLocaleString()}
    `;
    
    await telegram.sendMessage(adminId, statusMsg, { parse_mode: 'Markdown' });
});

// /help - Komandalar
telegram.onText(/\/help/, async (msg) => {
    if (msg.chat.id != adminId) return;
    
    const helpMsg = `
🤖 **Bot Commands**

/status - Bot vəziyyəti
/help - Bu yardım mesajı
/restart - Botu yenidən başlat
/logout - WhatsApp session sil
/stats - Detallı statistika
/clear - Message map təmizlə
    `;
    
    await telegram.sendMessage(adminId, helpMsg, { parse_mode: 'Markdown' });
});

// /restart - Botu yenidən başlat
telegram.onText(/\/restart/, (msg) => {
    if (msg.chat.id != adminId) return;
    telegram.sendMessage(adminId, '🔄 Bot yenidən başladılır...').catch(() => {});
    autoRestart();
});

// /logout - WhatsApp session sil
telegram.onText(/\/logout/, async (msg) => {
    if (msg.chat.id != adminId) return;
    try {
        await whatsapp.logout();
        await telegram.sendMessage(adminId, '✅ WhatsApp session silindi. Bot yenidən başladılır...');
        autoRestart();
    } catch (e) {
        logger.error('Logout xətası:', e.message);
        await telegram.sendMessage(adminId, '❌ Logout xətası: ' + e.message);
    }
});

// /stats - Detallı statistika
telegram.onText(/\/stats/, async (msg) => {
    if (msg.chat.id != adminId) return;
    
    const statsMsg = `
📈 **Detailed Statistics**

📨 WhatsApp Messages: ${stats.whatsappMessages}
📤 Telegram Messages: ${stats.telegramMessages}
❌ Errors: ${stats.errors}
🗺️ Active Message Maps: ${messageMap.size}
🚀 Started: ${stats.startTime.toLocaleString()}
⏱️ Uptime: ${Math.floor(process.uptime())} seconds
    `;
    
    await telegram.sendMessage(adminId, statsMsg, { parse_mode: 'Markdown' });
});

// /clear - Message map təmizlə
telegram.onText(/\/clear/, async (msg) => {
    if (msg.chat.id != adminId) return;
    messageMap.clear();
    await telegram.sendMessage(adminId, '✅ Message map təmizləndi.');
});

// Stabillik üçün – avtomatik yenidən başla
process.on('uncaughtException', (err) => {
    logger.error('Kritik xəta:', err.message);
    stats.errors++;
    autoRestart();
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', reason);
    stats.errors++;
});

// Logs qovluğunu yarat
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// WhatsApp client-i başlat
logger.info('Bot başladılır...');
whatsapp.initialize();
