const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// ============ KONFİQURASİYA ============
const config = {
    token: process.env.TELEGRAM_TOKEN,
    adminId: process.env.TELEGRAM_ADMIN_ID
};

if (!config.token || !config.adminId) {
    console.error('❌ Xəta: TELEGRAM_TOKEN və ya TELEGRAM_ADMIN_ID tapılmadı!');
    process.exit(1);
}

// ============ BOTLARIN BAŞLADILMASI ============
const telegram = new TelegramBot(config.token, { polling: true });
const whatsapp = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

// ============ YARDIMÇI FUNKSİYALAR ============
function escapeMarkdown(text) {
    if (!text) return '';
    return text.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

async function sendToTelegram(text, options = {}) {
    try {
        return await telegram.sendMessage(config.adminId, text, options);
    } catch (e) {
        console.error('Telegram göndərim xətası:', e.message);
    }
}

// ============ WHATSAPP HADİSƏLƏRİ ============

// QR Kodu Telegram-a şəkil kimi göndər
whatsapp.on('qr', (qr) => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    telegram.sendPhoto(config.adminId, qrUrl, { caption: '📱 WhatsApp QR kodunu skan edin.' });
});

// Hazır olanda bildiriş ver
whatsapp.on('ready', () => {
    sendToTelegram('✅ *WhatsApp UserBot aktivdir!*', { parse_mode: 'Markdown' });
});

// Mesajları ötür
whatsapp.on('message', async (msg) => {
    try {
        if (msg.fromMe) return;

        const contact = await msg.getContact();
        const chat = await msg.getChat();
        const name = contact.name || contact.pushname || msg.from.split('@')[0];
        
        let report = `👤 *${escapeMarkdown(name)}*${chat.isGroup ? ` (👥 ${escapeMarkdown(chat.name)})` : ''}\n`;
        report += `📱 \`${msg.from.split('@')[0]}\`\n\n`;
        report += `📝 ${escapeMarkdown(msg.body || '[Media]')}`;

        await sendToTelegram(report, { parse_mode: 'Markdown' });

        // Media varsa göndər
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media) {
                const buffer = Buffer.from(media.data, 'base64');
                const caption = `📎 Media: ${name}`;
                
                if (msg.type === 'image') await telegram.sendPhoto(config.adminId, buffer, { caption });
                else if (msg.type === 'video') await telegram.sendVideo(config.adminId, buffer, { caption });
                else if (msg.type === 'audio' || msg.type === 'ptt') await telegram.sendAudio(config.adminId, buffer, { caption });
                else await telegram.sendDocument(config.adminId, buffer, { caption, filename: media.filename });
            }
        }
    } catch (e) {
        console.error('Mesaj emalı xətası:', e.message);
    }
});

// ============ XƏTA İDARƏETMƏSİ (STABİLLİK) ============
process.on('uncaughtException', (err) => {
    console.error('Kritik xəta:', err.message);
    if (err.message.includes('detached Frame') || err.message.includes('Session closed')) {
        process.exit(1); // Railway botu avtomatik yenidən başladacaq
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

whatsapp.initialize();
