const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const TelegramBot = require('node-telegram-bot-api');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const winston = require('winston');
const path = require('path');

// ============ LOG SİSTEMİ ============
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(logsDir, 'error.log'), 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: path.join(logsDir, 'combined.log') 
        }),
        new winston.transports.Console()
    ]
});

// ============ KONFİQURASİYA ============
let config = {
    telegram: {
        token: process.env.TELEGRAM_TOKEN,
        admin_chat_id: process.env.TELEGRAM_ADMIN_ID
    },
    settings: {
        auto_replier: process.env.AUTO_REPLIER === 'true',
        replier_message: process.env.REPLIER_MESSAGE || "Salam! Mesajınız alındı. Tezliklə cavab verəcəm.",
        debug_mode: process.env.DEBUG_MODE === 'true',
        ignore_statuses: process.env.IGNORE_STATUSES === 'true',
        health_port: process.env.HEALTH_PORT || 3000
    }
};

// Config.json varsa yüklə
if (fs.existsSync('config.json')) {
    try {
        const localConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        config.telegram = { ...config.telegram, ...localConfig.telegram };
        config.settings = { ...config.settings, ...localConfig.settings };
        logger.info('config.json yükləndi');
    } catch (error) {
        logger.warn('config.json oxunarkən xəta, mühit dəyişənləri ilə davam edilir');
    }
}

// Yoxlama
if (!config.telegram.token || !config.telegram.admin_chat_id) {
    logger.error('Telegram token və ya Admin ID çatışmır!');
    process.exit(1);
}

// ============ STATİSTİKA SİSTEMİ ============
const stats = {
    messagesReceived: 0,
    messagesSent: 0,
    mediaReceived: 0,
    mediaSent: 0,
    groups: 0,
    privateChats: 0,
    startTime: new Date(),
    daily: {},
    
    incrementReceived() {
        this.messagesReceived++;
        this.trackDaily('received');
    },
    
    incrementSent() {
        this.messagesSent++;
        this.trackDaily('sent');
    },
    
    incrementMediaReceived() {
        this.mediaReceived++;
        this.trackDaily('mediaReceived');
    },
    
    incrementMediaSent() {
        this.mediaSent++;
        this.trackDaily('mediaSent');
    },
    
    trackDaily(type) {
        const today = new Date().toISOString().split('T')[0];
        if (!this.daily[today]) {
            this.daily[today] = {
                received: 0,
                sent: 0,
                mediaReceived: 0,
                mediaSent: 0
            };
        }
        this.daily[today][type]++;
    },
    
    getUptime() {
        const uptime = Math.floor((new Date() - this.startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        return `${hours}s ${minutes}d ${seconds}s`;
    }
};

// ============ EXPRESS HEALTH CHECK ============
const app = express();
const port = config.settings.health_port;

app.get('/health', async (req, res) => {
    try {
        const state = await whatsapp.getState();
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            whatsapp: state,
            uptime: stats.getUptime(),
            stats: {
                messagesReceived: stats.messagesReceived,
                messagesSent: stats.messagesSent,
                mediaReceived: stats.mediaReceived,
                mediaSent: stats.mediaSent
            },
            memory: {
                usage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
            }
        });
        logger.info(`Health check: ${state}`);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
        logger.error(`Health check xətası: ${error.message}`);
    }
});

app.listen(port, () => {
    logger.info(`Health check endpoint: http://localhost:${port}/health`);
});

// ============ TELEGRAM BOT ============
const telegram = new TelegramBot(config.telegram.token, { polling: true });

// Inline Keyboard menyular
const mainMenuKeyboard = {
    reply_markup: {
        keyboard: [
            ['📤 Mesaj Göndər', '📎 Media Göndər'],
            ['📊 Statistika', '⚙️ Status'],
            ['❓ Kömək']
        ],
        resize_keyboard: true,
        persistent: true
    }
};

const backKeyboard = {
    reply_markup: {
        keyboard: [
            ['🔙 Ana Menyu']
        ],
        resize_keyboard: true
    }
};

// ============ WHATSAPP CLIENT ============
const whatsapp = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
});

// ============ YARDIMÇI FUNKSİYALAR ============

function escapeMarkdown(text) {
    if (!text) return '';
    return text.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function formatPhoneNumber(whatsappId) {
    if (!whatsappId) return 'Naməlum';
    let cleanNumber = whatsappId
        .replace('@c.us', '')
        .replace('@g.us', '')
        .replace('@lid', '')
        .replace('@broadcast', '')
        .replace(/[^0-9]/g, '');
    if (!cleanNumber || cleanNumber.length < 5) return whatsappId;
    return cleanNumber;
}

function normalizePhoneNumber(number) {
    let clean = number.replace(/[\s\-\(\)\+]/g, '');
    clean = clean.replace('@c.us', '');
    if (clean.length < 10) return null;
    return clean + '@c.us';
}

async function getContactInfo(msg) {
    try {
        const contact = await msg.getContact();
        const chat = await msg.getChat();
        let rawNumber = null;

        if (contact && contact.id && contact.id._serialized) rawNumber = contact.id._serialized;
        if (!rawNumber && contact && contact.number) rawNumber = contact.number;
        if (!rawNumber && msg.author) rawNumber = msg.author;
        if (!rawNumber && msg.from) rawNumber = msg.from;

        let phoneNumber = formatPhoneNumber(rawNumber);
        let contactName = 'Naməlum';

        if (contact.pushname && contact.pushname.trim()) contactName = contact.pushname;
        else if (contact.name && contact.name.trim()) contactName = contact.name;
        else if (!chat.isGroup && chat.name && chat.name.trim()) contactName = chat.name;

        return {
            name: contactName,
            phone: phoneNumber,
            rawFormat: rawNumber,
            isBusiness: contact.isBusiness || false,
            isGroup: chat.isGroup || false,
            groupName: chat.isGroup ? (chat.name || 'Naməlum Qrup') : null
        };
    } catch (error) {
        logger.error(`Kontakt məlumatı xətası: ${error.message}`);
        return {
            name: 'Naməlum',
            phone: formatPhoneNumber(msg.from),
            isGroup: false
        };
    }
}

function getMessageType(msg) {
    if (msg.isStatus) return '📊 Status';
    if (msg.hasMedia) {
        const types = {
            'image': '🖼 Şəkil',
            'video': '🎥 Video',
            'audio': '🎵 Audio',
            'document': '📄 Sənəd',
            'sticker': '🏷 Stiker',
            'ptt': '🎤 Səsli mesaj'
        };
        return types[msg.type] || '📎 Media';
    }
    return '💬';
}

async function sendToTelegram(text, options = {}) {
    try {
        await telegram.sendMessage(config.telegram.admin_chat_id, text, options);
    } catch (error) {
        logger.error(`Telegram göndərim xətası: ${error.message}`);
    }
}

function isAdmin(chatId) {
    return chatId.toString() === config.telegram.admin_chat_id.toString();
}

// ============ URL-DƏN MEDİA YÜKLƏMƏ ============
async function downloadFromUrl(url) {
    try {
        logger.info(`URL-dən yüklənir: ${url}`);
        const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            timeout: 30000 
        });
        
        const contentType = response.headers['content-type'];
        const extension = contentType.split('/')[1] || 'jpg';
        const base64Data = Buffer.from(response.data).toString('base64');
        
        return {
            base64: base64Data,
            mimeType: contentType,
            extension: extension,
            filename: `download_${Date.now()}.${extension}`
        };
    } catch (error) {
        logger.error(`URL yükləmə xətası: ${error.message}`);
        throw new Error(`URL-dən yükləmə alınmadı: ${error.message}`);
    }
}

// ============ İNLİNE DÜYMƏ İDARƏETMƏSİ ============
telegram.onText(/📤 Mesaj Göndər/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const info = `📤 *Mətn Mesajı Göndərmək üçün:*\n\n` +
        `Format: \`/send 994501234567 Mesajınız\`\n\n` +
        `*Nömrə formatları:*\n` +
        `• 994501234567\n` +
        `• +994501234567\n` +
        `• 0501234567`;
    
    await telegram.sendMessage(msg.chat.id, info, { parse_mode: 'Markdown' });
});

telegram.onText(/📎 Media Göndər/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const info = `📎 *Media Göndərmək üçün 3 yol:*\n\n` +
        `*1. Reply ilə:*\n` +
        `• Media faylı bura göndərin\n` +
        `• Həmin fayla reply edin\n` +
        `• \`/send 994501234567\` yazın\n\n` +
        `*2. URL ilə:*\n` +
        `• \`/sendurl 994501234567 https://example.com/image.jpg\`\n\n` +
        `*3. Birbaşa komanda:*\n` +
        `• Şəkil göndərin və caption-a \`/to 994501234567\` yazın`;
    
    await telegram.sendMessage(msg.chat.id, info, { parse_mode: 'Markdown' });
});

telegram.onText(/📊 Statistika/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.daily[today] || { received: 0, sent: 0, mediaReceived: 0, mediaSent: 0 };
    
    const report = `📊 *Statistika*\n\n` +
        `⏰ İşləmə müddəti: ${stats.getUptime()}\n\n` +
        `*Ümumi:*\n` +
        `📨 Qəbul edilən mesaj: ${stats.messagesReceived}\n` +
        `📤 Göndərilən mesaj: ${stats.messagesSent}\n` +
        `📥 Qəbul edilən media: ${stats.mediaReceived}\n` +
        `📎 Göndərilən media: ${stats.mediaSent}\n\n` +
        `*Bu gün:*\n` +
        `📨 Qəbul: ${todayStats.received}\n` +
        `📤 Göndərilən: ${todayStats.sent}\n` +
        `📥 Media qəbul: ${todayStats.mediaReceived}\n` +
        `📎 Media göndərilib: ${todayStats.mediaSent}`;
    
    await telegram.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
});

telegram.onText(/⚙️ Status/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const state = await whatsapp.getState();
    const memory = process.memoryUsage();
    
    const status = `⚙️ *Sistem Statusu*\n\n` +
        `WhatsApp: ${state === 'CONNECTED' ? '✅ Bağlıdır' : '❌ Bağlı deyil'}\n` +
        `RAM: ${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB\n` +
        `İşləmə müddəti: ${stats.getUptime()}\n` +
        `Saat: ${new Date().toLocaleString('az-AZ')}`;
    
    await telegram.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
});

telegram.onText(/❓ Kömək/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const help = `🤖 *WhatsApp Bridge Bot*\n\n` +
        `*Əsas komandalar:*\n` +
        `📤 \`/send [nömrə] [mesaj]\` - Mətn göndər\n` +
        `🔗 \`/sendurl [nömrə] [url]\` - URL-dən media göndər\n` +
        `📢 \`/broadcast [nömrələr] [mesaj]\` - Kütləvi mesaj\n` +
        `📊 \`/stats\` - Statistika\n` +
        `🔍 \`/check [nömrə]\` - Nömrə yoxla`;
    
    await telegram.sendMessage(msg.chat.id, help, { parse_mode: 'Markdown' });
});

telegram.onText(/🔙 Ana Menyu/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    await telegram.sendMessage(msg.chat.id, 'Ana menyu:', mainMenuKeyboard);
});

// ============ KOMANDALAR ============

// /start - Ana menyunu göstər
telegram.onText(/\/start/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    await telegram.sendMessage(
        msg.chat.id, 
        '🤖 *WhatsApp Bridge Bot-a xoş gəldiniz!*\nAşağıdakı menyudan seçim edin:', 
        { ...mainMenuKeyboard, parse_mode: 'Markdown' }
    );
});

// /sendurl - URL-dən media göndər
telegram.onText(/\/sendurl (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const args = match[1].split(/\s+/);
    if (args.length < 2) {
        await telegram.sendMessage(
            msg.chat.id, 
            '⚠️ Format: `/sendurl 994501234567 https://example.com/image.jpg`',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const phoneNumber = args[0];
    const url = args[1];
    
    try {
        const normalizedNumber = normalizePhoneNumber(phoneNumber);
        if (!normalizedNumber) {
            await telegram.sendMessage(msg.chat.id, '❌ Yanlış nömrə formatı.');
            return;
        }
        
        const isRegistered = await whatsapp.isRegisteredUser(normalizedNumber);
        if (!isRegistered) {
            await telegram.sendMessage(msg.chat.id, '⚠️ Bu nömrə WhatsApp-da qeydiyyatlı deyil.');
            return;
        }
        
        const statusMsg = await telegram.sendMessage(msg.chat.id, '📥 URL-dən yüklənir...');
        
        // URL-dən yüklə
        const mediaData = await downloadFromUrl(url);
        
        await telegram.editMessageText('📤 WhatsApp-a göndərilir...', {
            chat_id: statusMsg.chat.id,
            message_id: statusMsg.message_id
        });
        
        const media = new MessageMedia(mediaData.mimeType, mediaData.base64, mediaData.filename);
        await whatsapp.sendMessage(normalizedNumber, media);
        
        await telegram.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
        
        stats.incrementMediaSent();
        logger.info(`URL media göndərildi: ${normalizedNumber} - ${url}`);
        
        await telegram.sendMessage(
            msg.chat.id,
            `✅ *URL-dən media göndərildi!*\n📱 Nömrə: \`${normalizedNumber.replace('@c.us', '')}\`\n🔗 URL: ${url}`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        logger.error(`URL media göndərmə xətası: ${error.message}`);
        await telegram.sendMessage(
            msg.chat.id,
            `❌ Xəta: ${escapeMarkdown(error.message)}`,
            { parse_mode: 'Markdown' }
        );
    }
});

// /send - Mesaj/media göndər
telegram.onText(/\/send/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const parts = msg.text.split(/\s+/);
    
    // Reply edilmiş media varsa
    if (msg.reply_to_message && (msg.reply_to_message.photo || msg.reply_to_message.video ||
        msg.reply_to_message.document || msg.reply_to_message.audio || msg.reply_to_message.voice ||
        msg.reply_to_message.sticker)) {
        
        if (parts.length < 2) {
            await telegram.sendMessage(msg.chat.id, '⚠️ Nömrə daxil edin.');
            return;
        }
        
        const phoneNumber = parts[1];
        const caption = parts.slice(2).join(' ') || '';
        
        let statusMsg;
        try {
            const normalizedNumber = normalizePhoneNumber(phoneNumber);
            if (!normalizedNumber) {
                await telegram.sendMessage(msg.chat.id, '❌ Yanlış nömrə formatı.');
                return;
            }
            
            const isRegistered = await whatsapp.isRegisteredUser(normalizedNumber);
            if (!isRegistered) {
                await telegram.sendMessage(msg.chat.id, '⚠️ Bu nömrə WhatsApp-da qeydiyyatlı deyil.');
                return;
            }
            
            statusMsg = await telegram.sendMessage(msg.chat.id, '📤 Media göndərilir...');
            
            let fileUrl;
            let mediaType;
            let fileName;
            let mimeType;
            
            if (msg.reply_to_message.photo) {
                const photo = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1];
                const file = await telegram.getFile(photo.file_id);
                fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
                mediaType = 'photo';
                fileName = 'image.jpg';
                mimeType = 'image/jpeg';
            } else if (msg.reply_to_message.video) {
                const file = await telegram.getFile(msg.reply_to_message.video.file_id);
                fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
                mediaType = 'video';
                fileName = msg.reply_to_message.video.file_name || 'video.mp4';
                mimeType = msg.reply_to_message.video.mime_type || 'video/mp4';
            } else if (msg.reply_to_message.document) {
                const file = await telegram.getFile(msg.reply_to_message.document.file_id);
                fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
                mediaType = 'document';
                fileName = msg.reply_to_message.document.file_name || 'document';
                mimeType = msg.reply_to_message.document.mime_type || 'application/octet-stream';
            } else if (msg.reply_to_message.audio) {
                const file = await telegram.getFile(msg.reply_to_message.audio.file_id);
                fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
                mediaType = 'audio';
                fileName = msg.reply_to_message.audio.file_name || 'audio.mp3';
                mimeType = msg.reply_to_message.audio.mime_type || 'audio/mpeg';
            } else if (msg.reply_to_message.voice) {
                const file = await telegram.getFile(msg.reply_to_message.voice.file_id);
                fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
                mediaType = 'audio';
                fileName = 'voice.ogg';
                mimeType = msg.reply_to_message.voice.mime_type || 'audio/ogg';
            } else if (msg.reply_to_message.sticker) {
                const file = await telegram.getFile(msg.reply_to_message.sticker.file_id);
                fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
                mediaType = 'sticker';
                fileName = 'sticker.webp';
                mimeType = 'image/webp';
            }
            
            const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
            const base64Data = Buffer.from(response.data).toString('base64');
            
            const media = new MessageMedia(mimeType, base64Data, fileName);
            await whatsapp.sendMessage(normalizedNumber, media, { caption: caption || undefined });
            
            await telegram.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
            
            stats.incrementMediaSent();
            logger.info(`Media göndərildi: ${normalizedNumber} - ${mediaType}`);
            
            await telegram.sendMessage(
                msg.chat.id,
                `✅ Media göndərildi!\n📱 Nömrə: \`${normalizedNumber.replace('@c.us', '')}\`\n📁 Tip: ${mediaType}`,
                { parse_mode: 'Markdown' }
            );
            
        } catch (error) {
            logger.error(`Media göndərmə xətası: ${error.message}`);
            if (statusMsg) await telegram.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
            await telegram.sendMessage(msg.chat.id, `❌ Xəta: ${escapeMarkdown(error.message)}`);
        }
        return;
    }
    
    // Mətn mesajı
    if (parts.length < 3) {
        await telegram.sendMessage(msg.chat.id, '⚠️ Format: `/send 994501234567 Mesaj`', { parse_mode: 'Markdown' });
        return;
    }
    
    const phoneNumber = parts[1];
    const message = parts.slice(2).join(' ');
    
    try {
        const normalizedNumber = normalizePhoneNumber(phoneNumber);
        if (!normalizedNumber) {
            await telegram.sendMessage(msg.chat.id, '❌ Yanlış nömrə formatı.');
            return;
        }
        
        const isRegistered = await whatsapp.isRegisteredUser(normalizedNumber);
        if (!isRegistered) {
            await telegram.sendMessage(msg.chat.id, '⚠️ Bu nömrə WhatsApp-da qeydiyyatlı deyil.');
            return;
        }
        
        await whatsapp.sendMessage(normalizedNumber, message);
        
        stats.incrementSent();
        logger.info(`Mesaj göndərildi: ${normalizedNumber}`);
        
        await telegram.sendMessage(
            msg.chat.id,
            `✅ Mesaj göndərildi!\n📱 Nömrə: \`${normalizedNumber.replace('@c.us', '')}\`\n📝 Mesaj: ${escapeMarkdown(message)}`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        logger.error(`Mesaj göndərmə xətası: ${error.message}`);
        await telegram.sendMessage(msg.chat.id, `❌ Xəta: ${escapeMarkdown(error.message)}`);
    }
});

// /stats - Statistika
telegram.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.daily[today] || { received: 0, sent: 0, mediaReceived: 0, mediaSent: 0 };
    
    const report = `📊 *Statistika*\n\n` +
        `⏰ İşləmə müddəti: ${stats.getUptime()}\n\n` +
        `*Ümumi:*\n` +
        `📨 Qəbul: ${stats.messagesReceived}\n` +
        `📤 Göndərilən: ${stats.messagesSent}\n` +
        `📥 Media qəbul: ${stats.mediaReceived}\n` +
        `📎 Media göndərilib: ${stats.mediaSent}\n\n` +
        `*Bu gün:*\n` +
        `📨 Qəbul: ${todayStats.received}\n` +
        `📤 Göndərilən: ${todayStats.sent}`;
    
    await telegram.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
});

// /check - Nömrə yoxla
telegram.onText(/\/check (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const number = match[1].trim();
    const normalizedNumber = normalizePhoneNumber(number);
    
    if (!normalizedNumber) {
        await telegram.sendMessage(msg.chat.id, '❌ Yanlış nömrə formatı.');
        return;
    }
    
    const isRegistered = await whatsapp.isRegisteredUser(normalizedNumber);
    const cleanNumber = formatPhoneNumber(normalizedNumber);
    
    await telegram.sendMessage(
        msg.chat.id,
        `🔍 *Nömrə yoxlaması*\n📱 Nömrə: \`${cleanNumber}\`\nStatus: ${isRegistered ? '✅ WhatsApp-da qeydiyyatlı' : '❌ Qeydiyyatlı deyil'}`,
        { parse_mode: 'Markdown' }
    );
});

// /broadcast - Kütləvi mesaj
telegram.onText(/\/broadcast/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const parts = msg.text.split(/\s+/);
    if (parts.length < 3) {
        await telegram.sendMessage(
            msg.chat.id, 
            '⚠️ Format: `/broadcast 994501234567,994502345678 Mesaj`',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const numbers = parts[1].split(',');
    const message = parts.slice(2).join(' ');
    
    let successCount = 0;
    let failCount = 0;
    
    const statusMsg = await telegram.sendMessage(msg.chat.id, `📤 ${numbers.length} nömrəyə göndərilir...`);
    
    for (let i = 0; i < numbers.length; i++) {
        try {
            const normalizedNumber = normalizePhoneNumber(numbers[i].trim());
            if (!normalizedNumber || !(await whatsapp.isRegisteredUser(normalizedNumber))) {
                failCount++;
                continue;
            }
            
            await whatsapp.sendMessage(normalizedNumber, message);
            successCount++;
            stats.incrementSent();
            
        } catch (error) {
            logger.error(`Broadcast xətası (${numbers[i]}): ${error.message}`);
            failCount++;
        }
        
        if (i % 5 === 0 || i === numbers.length - 1) {
            try {
                await telegram.editMessageText(
                    `📤 ${i + 1}/${numbers.length}\n✅ ${successCount} | ❌ ${failCount}`,
                    { chat_id: statusMsg.chat.id, message_id: statusMsg.message_id }
                );
            } catch (e) {}
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    logger.info(`Broadcast tamamlandı: ${successCount}/${numbers.length}`);
    
    await telegram.editMessageText(
        `✅ Tamamlandı!\n✅ Uğurlu: ${successCount}\n❌ Uğursuz: ${failCount}`,
        { chat_id: statusMsg.chat.id, message_id: statusMsg.message_id }
    );
});

// ============ WHATSAPP EVENTLƏRİ ============

whatsapp.on('qr', (qr) => {
    logger.info('QR kod yaradıldı');
    console.log('--- QR KODU HAZIRDIR ---');
    
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    
    telegram.sendPhoto(config.telegram.admin_chat_id, qrImageUrl, {
        caption: "📱 *WhatsApp QR kodu hazırdır*\n\nZəhmət olmasa bu kodu WhatsApp-dan skan edin.",
        parse_mode: 'Markdown'
    }).catch(err => {
        logger.error(`QR göndərmə xətası: ${err.message}`);
        qrcode.generate(qr, { small: true });
    });
});

whatsapp.on('ready', () => {
    logger.info('WhatsApp bağlantısı quruldu');
    console.log('✅ WhatsApp hazırdır!');
    
    sendToTelegram(
        '✅ *WhatsApp bağlantısı quruldu!*\nAşağıdakı menyudan istifadə edin:',
        { ...mainMenuKeyboard, parse_mode: 'Markdown' }
    );
});

whatsapp.on('auth_failure', (msg) => {
    logger.error(`Doğrulama xətası: ${msg}`);
    sendToTelegram(`❌ *WhatsApp doğrulama xətası:* \`${msg}\``, { parse_mode: 'Markdown' });
});

whatsapp.on('disconnected', (reason) => {
    logger.warn(`Bağlantı kəsildi: ${reason}`);
    sendToTelegram(`⚠️ *WhatsApp bağlantısı kəsildi*\nSəbəb: ${reason}`, { parse_mode: 'Markdown' });
});

// WhatsApp-dan gələn mesajları Telegram-a ötür
whatsapp.on('message', async (msg) => {
    try {
        if (msg.fromMe) return;
        if (msg.isStatus && config.settings?.ignore_statuses) return;
        
        const contactInfo = await getContactInfo(msg);
        if (!contactInfo) return;
        
        stats.incrementReceived();
        
        const messageType = getMessageType(msg);
        const timestamp = new Date(msg.timestamp * 1000).toLocaleString('az-AZ');
        
        let messageBody = msg.body;
        if (!messageBody && msg.hasMedia) messageBody = `[${messageType}]`;
        
        let report = `📨 *Yeni Mesaj*\n⏰ ${timestamp}\n`;
        
        if (contactInfo.isGroup) {
            report += `👥 Qrup: ${escapeMarkdown(contactInfo.groupName)}\n` +
                `👤 Göndərən: ${escapeMarkdown(contactInfo.name)}\n` +
                `📱 Nömrə: \`${contactInfo.phone}\`\n`;
        } else {
            report += `👤 Kimdən: ${escapeMarkdown(contactInfo.name)}\n` +
                `📱 Nömrə: \`${contactInfo.phone}\`\n`;
        }
        
        report += `📝 ${messageType}: ${escapeMarkdown(messageBody)}`;
        
        await sendToTelegram(report, { parse_mode: 'Markdown' });
        logger.info(`Mesaj qəbul edildi: ${contactInfo.phone} - ${messageType}`);
        
        // Media varsa göndər
        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                if (media && media.data) {
                    stats.incrementMediaReceived();
                    
                    const mediaBuffer = Buffer.from(media.data, 'base64');
                    const caption = contactInfo.isGroup
                        ? `👥 ${escapeMarkdown(contactInfo.groupName)} - 👤 ${escapeMarkdown(contactInfo.name)} (${contactInfo.phone})`
                        : `👤 ${escapeMarkdown(contactInfo.name)} (${contactInfo.phone})`;
                    
                    switch (msg.type) {
                        case 'image':
                        case 'sticker':
                            await telegram.sendPhoto(config.telegram.admin_chat_id, mediaBuffer, {
                                caption: `📸 ${caption}`, parse_mode: 'Markdown'
                            });
                            break;
                        case 'video':
                            await telegram.sendVideo(config.telegram.admin_chat_id, mediaBuffer, {
                                caption: `🎥 ${caption}`, parse_mode: 'Markdown'
                            });
                            break;
                        case 'audio':
                        case 'ptt':
                            await telegram.sendAudio(config.telegram.admin_chat_id, mediaBuffer, {
                                caption: `🎵 ${caption}`, parse_mode: 'Markdown'
                            });
                            break;
                        case 'document':
                            await telegram.sendDocument(config.telegram.admin_chat_id, mediaBuffer, {
                                caption: `📄 ${caption}`, parse_mode: 'Markdown'
                            });
                            break;
                    }
                }
            } catch (mediaError) {
                logger.error(`Media yükləmə xətası: ${mediaError.message}`);
            }
        }
        
    } catch (error) {
        logger.error(`Mesaj emalı xətası: ${error.message}`);
    }
});

// ============ XƏTA İDARƏETMƏSİ ============

process.on('uncaughtException', (error) => {
    logger.error(`Gözlənilməz xəta: ${error.message}`);
    if (error.message.includes('detached Frame') || error.message.includes('Session closed')) {
        process.exit(1);
    }
    sendToTelegram(`🚨 *Kritik xəta:* \`${escapeMarkdown(error.message)}\``, { parse_mode: 'Markdown' });
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(`İşlənməmiş rejection: ${reason}`);
});

// ============ BAŞLAT ============

logger.info('🚀 Bot başladılır...');
console.log('🚀 Bot başladılır...');
console.log(`Health check: http://localhost:${port}/health`);
whatsapp.initialize();
