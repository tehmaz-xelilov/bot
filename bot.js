const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const TelegramBot = require('node-telegram-bot-api');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

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

const userStates = {}; // { chatId: { type: 'REPLY', number: '...' } }

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
whatsapp.on('qr', (qr) => {
    console.log('QR Kod hazırdır. Skan edin...');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    telegram.sendPhoto(config.adminId, qrUrl, { caption: '📱 WhatsApp QR kodunu skan edin.' });
});

whatsapp.on('ready', () => {
    console.log('✅ WhatsApp qoşuldu!');
    sendToTelegram('✅ *WhatsApp UserBot aktivdir!*', { parse_mode: 'Markdown' });
});

whatsapp.on('message', async (msg) => {
    try {
        if (msg.fromMe) return;

        const contact = await msg.getContact();
        const chat = await msg.getChat();
        const name = contact.name || contact.pushname || msg.from.split('@')[0];
        const isGroup = chat.isGroup;
        
        let report = `👤 *${escapeMarkdown(name)}*${isGroup ? ` (👥 ${escapeMarkdown(chat.name)})` : ''}\n`;
        report += `📱 \`${msg.from.split('@')[0]}\`\n\n`;
        report += `📝 ${escapeMarkdown(msg.body || '[Media]')}`;

        const options = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '💬 Cavab Yaz', callback_data: `reply_${msg.from}` }]]
            }
        };

        await sendToTelegram(report, options);

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

// ============ TELEGRAM HADİSƏLƏRİ ============
telegram.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (query.data.startsWith('reply_')) {
        const number = query.data.replace('reply_', '');
        userStates[chatId] = { type: 'AWAITING_REPLY', number: number };
        
        await telegram.answerCallbackQuery(query.id);
        await telegram.sendMessage(chatId, `💬 *${number.split('@')[0]}* üçün cavabınızı yazın:`, { 
            parse_mode: 'Markdown',
            reply_markup: { force_reply: true }
        });
    }
});

telegram.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text === '/start') {
        return sendToTelegram('🚀 Bot hazır vəziyyətdədir. Mesaj gələndə bura ötürüləcək.');
    }

    const state = userStates[chatId];
    if (state && state.type === 'AWAITING_REPLY' && msg.text) {
        try {
            await whatsapp.sendMessage(state.number, msg.text);
            await telegram.sendMessage(chatId, '✅ Mesaj göndərildi.');
            delete userStates[chatId];
        } catch (e) {
            await telegram.sendMessage(chatId, `❌ Xəta baş verdi: ${e.message}`);
        }
    }
});

// ============ XƏTA İDARƏETMƏSİ (AUTO-RESTART) ============
process.on('uncaughtException', (err) => {
    console.error('Kritik xəta:', err.message);
    if (err.message.includes('detached Frame') || err.message.includes('Session closed')) {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

console.log('🚀 Bot başladılır...');
whatsapp.initialize();
