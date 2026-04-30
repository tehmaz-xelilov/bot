const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const TelegramBot = require('node-telegram-bot-api');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const axios = require('axios');

// Konfiqurasiyanı yüklə
let config = {
    telegram: {
        token: process.env.TELEGRAM_TOKEN,
        admin_chat_id: process.env.TELEGRAM_ADMIN_ID
    },
    settings: {
        auto_replier: process.env.AUTO_REPLIER === 'true',
        replier_message: process.env.REPLIER_MESSAGE || "Salam! Mesajınız alındı. Tezliklə cavab verəcəm.",
        debug_mode: process.env.DEBUG_MODE === 'true',
        ignore_statuses: process.env.IGNORE_STATUSES === 'true'
    }
};

// Əgər config.json varsa, onu da yüklə (local üçün)
if (fs.existsSync('config.json')) {
    try {
        const localConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        config.telegram = { ...config.telegram, ...localConfig.telegram };
        config.settings = { ...config.settings, ...localConfig.settings };
    } catch (error) {
        console.warn('⚠️ config.json oxunarkən xəta baş verdi, mühit dəyişənləri ilə davam edilir.');
    }
}

// Yoxlama
if (!config.telegram.token || !config.telegram.admin_chat_id) {
    console.error('❌ Telegram token və ya Admin ID çatışmır!');
    console.error('Zəhmət olmasa config.json faylını və ya mühit dəyişənlərini (TELEGRAM_TOKEN, TELEGRAM_ADMIN_ID) yoxlayın.');
    process.exit(1);
}

// Telegram Bot-u başlat
const telegram = new TelegramBot(config.telegram.token, { polling: true });

// WhatsApp Client-i başlat
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

function debugLog(message, data) {
    if (config.settings && config.settings.debug_mode) {
        console.log(`[DEBUG] ${message}:`, data);
    }
}

async function getContactInfo(msg) {
    try {
        const contact = await msg.getContact();
        const chat = await msg.getChat();
        let rawNumber = null;

        if (contact && contact.id && contact.id._serialized) rawNumber = contact.id._serialized;
        if (!rawNumber && contact && contact.number) rawNumber = contact.number;
        if (!rawNumber && contact && contact.id && contact.id.user) rawNumber = contact.id.user;
        if (!rawNumber && msg.author) rawNumber = msg.author;
        if (!rawNumber && msg.from) rawNumber = msg.from;
        if (!rawNumber && chat && chat.id && chat.id._serialized && !chat.isGroup) rawNumber = chat.id._serialized;

        let phoneNumber = formatPhoneNumber(rawNumber);
        let contactName = 'Naməlum';

        if (contact.pushname && contact.pushname.trim()) contactName = contact.pushname;
        else if (contact.name && contact.name.trim()) contactName = contact.name;
        else if (contact.shortName && contact.shortName.trim()) contactName = contact.shortName;
        else if (!chat.isGroup && chat.name && chat.name.trim()) contactName = chat.name;

        if (contactName === 'Naməlum' && phoneNumber !== 'Naməlum') contactName = phoneNumber;

        return {
            name: contactName,
            phone: phoneNumber,
            rawFormat: rawNumber,
            isBusiness: contact.isBusiness || false,
            isGroup: chat.isGroup || false,
            groupName: chat.isGroup ? (chat.name || 'Naməlum Qrup') : null,
            isMe: contact.isMe || false
        };
    } catch (error) {
        console.error('Kontakt məlumatı xətası:', error.message);
        return {
            name: msg.from || 'Naməlum',
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
            'ptt': '🎤 Səsli mesaj',
            'location': '📍 Mövqe'
        };
        return types[msg.type] || '📎 Media';
    }
    return '💬';
}

async function sendToTelegram(text, options = {}) {
    try {
        await telegram.sendMessage(config.telegram.admin_chat_id, text, options);
    } catch (error) {
        console.error('Telegram göndərim xətası:', error.message);
    }
}

function isAdmin(chatId) {
    return chatId.toString() === config.telegram.admin_chat_id.toString();
}

// ============ MEDIA GÖNDƏRMƏ FUNKSİYASI ============

async function sendWhatsAppMedia(msg, phoneNumber, caption) {
    let statusMsg;
    try {
        const normalizedNumber = normalizePhoneNumber(phoneNumber);

        if (!normalizedNumber) {
            await telegram.sendMessage(msg.chat.id, '❌ Yanlış nömrə formatı. Nümunə: 994501234567');
            return;
        }

        // Nömrənin WhatsApp-da qeydiyyatlı olduğunu yoxla
        const isRegistered = await whatsapp.isRegisteredUser(normalizedNumber);
        if (!isRegistered) {
            await telegram.sendMessage(msg.chat.id, '⚠️ Bu nömrə WhatsApp-da qeydiyyatlı deyil.');
            return;
        }

        // Status mesajı göndər
        statusMsg = await telegram.sendMessage(msg.chat.id, '📤 Media yüklənir...');

        // Telegram-dan faylı endir
        let fileUrl;
        let mediaType;
        let fileName;
        let mimeType;

        if (msg.reply_to_message.photo) {
            const photoArray = msg.reply_to_message.photo;
            const photo = photoArray[photoArray.length - 1];
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
        } else {
            await telegram.sendMessage(msg.chat.id, '❌ Dəstəklənməyən media tipi.');
            return;
        }

        // Status yenilə
        await telegram.editMessageText('📥 Fayl endirilir...', {
            chat_id: statusMsg.chat.id,
            message_id: statusMsg.message_id
        });

        // Axios ilə faylı endir
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const base64Data = Buffer.from(response.data).toString('base64');

        // Status yenilə
        await telegram.editMessageText('📤 WhatsApp-a göndərilir...', {
            chat_id: statusMsg.chat.id,
            message_id: statusMsg.message_id
        });

        // WhatsApp-a göndər
        const media = new MessageMedia(mimeType, base64Data, fileName);

        await whatsapp.sendMessage(normalizedNumber, media, {
            caption: caption || undefined
        });

        // Status sil
        await telegram.deleteMessage(statusMsg.chat.id, statusMsg.message_id);

        // Uğurlu mesajı
        await telegram.sendMessage(
            msg.chat.id,
            `✅ *Media göndərildi!*\n📱 Nömrə: \`${normalizedNumber.replace('@c.us', '')}\`\n📁 Tip: ${mediaType}${caption ? `\n📝 Açıqlama: ${caption}` : ''}`,
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error('Media göndərmə xətası:', error);

        // Status mesajını sil (əgər varsa)
        if (statusMsg) {
            try {
                await telegram.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
            } catch (e) {
                // Silinə bilmədisə problem deyil
            }
        }

        await telegram.sendMessage(
            msg.chat.id,
            `❌ *Media göndərilə bilmədi*\nXəta: ${escapeMarkdown(error.message)}`,
            { parse_mode: 'Markdown' }
        );
    }
}

// ============ TELEGRAM KOMANDALARI ============

// /send komandası
telegram.onText(/\/send/, async (msg) => {
    if (!isAdmin(msg.chat.id)) {
        await telegram.sendMessage(msg.chat.id, '⛔ Bu komanda yalnız admin üçündür.');
        return;
    }

    const usage = `📤 *WhatsApp-a mesaj göndərmək üçün:*\n\n` +
        `*Mətn mesajı:* \`/send 994501234567 Salam\`\n` +
        `*Media göndərmək:*\n` +
        `1. Media faylı Telegram-a göndərin\n` +
        `2. Həmin mediaya reply edin\n` +
        `3. Belə yazın: \`/send 994501234567\`\n` +
        `4. İstəyə bağlı: \`/send 994501234567 Açıqlama mətni\`\n\n` +
        `*Nömrə formatları:*\n` +
        `• 994501234567\n` +
        `• +994501234567\n` +
        `• 0501234567`;

    // Sadəcə /send yazılıbsa - kömək göstər
    if (msg.text === '/send' || msg.text === '/send@' || msg.text.trim() === '/send') {
        await telegram.sendMessage(msg.chat.id, usage, { parse_mode: 'Markdown' });
        return;
    }

    // Reply edilmiş media varsa
    if (msg.reply_to_message && (msg.reply_to_message.photo || msg.reply_to_message.video ||
        msg.reply_to_message.document || msg.reply_to_message.audio || msg.reply_to_message.voice ||
        msg.reply_to_message.sticker)) {

        const args = msg.text.split(/\s+/);

        // Sadəcə /send yazılıbsa
        if (args.length < 2) {
            await telegram.sendMessage(msg.chat.id, '⚠️ Nömrə daxil edin.\n\n' + usage, { parse_mode: 'Markdown' });
            return;
        }

        const phoneNumber = args[1];
        const caption = args.slice(2).join(' ') || '';

        await sendWhatsAppMedia(msg, phoneNumber, caption);
        return;
    }

    // Normal mətn mesajı
    const parts = msg.text.split(/\s+/);
    if (parts.length < 3) {
        await telegram.sendMessage(msg.chat.id, '⚠️ Nömrə və mesaj daxil edin.\n\n' + usage, { parse_mode: 'Markdown' });
        return;
    }

    const phoneNumber = parts[1];
    const message = parts.slice(2).join(' ');

    // Mətn mesajı göndər
    try {
        const normalizedNumber = normalizePhoneNumber(phoneNumber);

        if (!normalizedNumber) {
            await telegram.sendMessage(msg.chat.id, '❌ Yanlış nömrə formatı. Nümunə: 994501234567');
            return;
        }

        const isRegistered = await whatsapp.isRegisteredUser(normalizedNumber);

        if (!isRegistered) {
            await telegram.sendMessage(msg.chat.id, '⚠️ Bu nömrə WhatsApp-da qeydiyyatlı deyil.');
            return;
        }

        await whatsapp.sendMessage(normalizedNumber, message);

        await telegram.sendMessage(
            msg.chat.id,
            `✅ *Mesaj göndərildi!*\n📱 Nömrə: \`${normalizedNumber.replace('@c.us', '')}\`\n📝 Mesaj: ${escapeMarkdown(message)}`,
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error('Mesaj göndərmə xətası:', error);
        await telegram.sendMessage(
            msg.chat.id,
            `❌ *Xəta:* ${escapeMarkdown(error.message)}`,
            { parse_mode: 'Markdown' }
        );
    }
});

// /broadcast komandası
telegram.onText(/\/broadcast/, async (msg) => {
    if (!isAdmin(msg.chat.id)) {
        await telegram.sendMessage(msg.chat.id, '⛔ Bu komanda yalnız admin üçündür.');
        return;
    }

    const usage = `📢 *Kütləvi mesaj göndərmək üçün:*\n\n` +
        `*Format:* \`/broadcast 994501234567,994502345678,994503456789 Salam hamıya\`\n\n` +
        `Nömrələri vergüllə ayırın.`;

    const parts = msg.text.split(/\s+/);
    if (parts.length < 3) {
        await telegram.sendMessage(msg.chat.id, usage, { parse_mode: 'Markdown' });
        return;
    }

    const numbers = parts[1].split(',');
    const message = parts.slice(2).join(' ');

    let successCount = 0;
    let failCount = 0;

    const statusMsg = await telegram.sendMessage(msg.chat.id, `📤 ${numbers.length} nömrəyə mesaj göndərilir...`);

    for (let i = 0; i < numbers.length; i++) {
        try {
            const normalizedNumber = normalizePhoneNumber(numbers[i].trim());

            if (!normalizedNumber) {
                failCount++;
                continue;
            }

            const isRegistered = await whatsapp.isRegisteredUser(normalizedNumber);

            if (isRegistered) {
                await whatsapp.sendMessage(normalizedNumber, message);
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            console.error(`${numbers[i]} nömrəsinə göndərilmədi:`, error.message);
            failCount++;
        }

        // Status yenilə
        if (i % 5 === 0 || i === numbers.length - 1) {
            try {
                await telegram.editMessageText(
                    `📤 Göndərilir: ${i + 1}/${numbers.length}\n✅ Uğurlu: ${successCount}\n❌ Uğursuz: ${failCount}`,
                    { chat_id: statusMsg.chat.id, message_id: statusMsg.message_id }
                );
            } catch (e) {
                // Edit error - ignore
            }
        }

        // Spam qarşısını almaq üçün gözləmə
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    await telegram.editMessageText(
        `✅ *Tamamlandı!*\n📊 Nəticə: ${successCount}/${numbers.length}\n✅ Uğurlu: ${successCount}\n❌ Uğursuz: ${failCount}`,
        { chat_id: statusMsg.chat.id, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
    );
});

// /status komandası
telegram.onText(/\/status/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    const state = await whatsapp.getState();
    const info = `📊 *Bot Statusu*\n\n` +
        `🔄 Vəziyyət: ${state}\n` +
        `⏰ Vaxt: ${new Date().toLocaleString('az-AZ')}\n` +
        `📱 WhatsApp: ${state === 'CONNECTED' ? '✅ Bağlıdır' : '❌ Bağlı deyil'}`;

    await telegram.sendMessage(msg.chat.id, info, { parse_mode: 'Markdown' });
});

// /help komandası
telegram.onText(/\/help/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    const help = `🤖 *WhatsApp Bridge Bot - Kömək*\n\n` +
        `*Əsas komandalar:*\n` +
        `📤 \`/send [nömrə] [mesaj]\` - Mətn mesajı göndər\n` +
        `📎 \`/send [nömrə]\` - Reply edilmiş medianı göndər\n` +
        `📢 \`/broadcast [nömrələr] [mesaj]\` - Kütləvi mesaj\n` +
        `📊 \`/status\` - Bot statusu\n` +
        `❓ \`/help\` - Bu menyu\n\n` +
        `*Media göndərmək üçün:*\n` +
        `1. Şəkil/video/sənəd/stikeri Telegram-a göndərin\n` +
        `2. Həmin fayla reply (cavab) edin\n` +
        `3. \`/send 994501234567\` yazın\n\n` +
        `*Dəstəklənən media tipləri:*\n` +
        `🖼 Şəkil, 🎥 Video, 📄 Sənəd, 🎵 Audio, 🎤 Səs, 🏷 Stiker`;

    await telegram.sendMessage(msg.chat.id, help, { parse_mode: 'Markdown' });
});

// ============ EVENTLƏR ============

whatsapp.on('qr', (qr) => {
    console.log('--- QR KODU HAZIRDIR ---');

    // QR kodu şəkil kimi Telegram-a göndər
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;

    telegram.sendPhoto(config.telegram.admin_chat_id, qrImageUrl, {
        caption: "📱 *WhatsApp QR kodu hazırdır*\n\nZəhmət olmasa bu kodu WhatsApp-dan skan edin. Kodu skan etmək üçün 1 dəqiqəniz var.",
        parse_mode: 'Markdown'
    }).catch(err => {
        console.error('QR mesajı xətası:', err);
        // Əgər şəkil göndərilməsə, terminalda göstər (ehtiyat variant)
        qrcode.generate(qr, { small: true });
    });
});

whatsapp.on('ready', () => {
    const readyMessage = '✅ *WhatsApp bağlantısı quruldu!*\n' +
        `🕒 Vaxt: ${new Date().toLocaleString('az-AZ')}\n` +
        `📱 Bütün mesajlar bura yönləndiriləcək.\n\n` +
        `*Əsas komandalar:*\n` +
        `📤 /send - Mesaj göndər\n` +
        `📎 /send - Reply ilə media göndər\n` +
        `📢 /broadcast - Kütləvi mesaj\n` +
        `❓ /help - Kömək`;

    console.log('✅ WhatsApp hazırdır!');
    sendToTelegram(readyMessage, { parse_mode: 'Markdown' });
});

whatsapp.on('auth_failure', (msg) => {
    console.error('❌ Doğrulama xətası:', msg);
    sendToTelegram(`❌ *WhatsApp doğrulama xətası:* \`${msg}\``, { parse_mode: 'Markdown' });
});

whatsapp.on('disconnected', (reason) => {
    console.log('⚠️ Bağlantı kəsildi:', reason);
    sendToTelegram(`⚠️ *WhatsApp bağlantısı kəsildi*\nSəbəb: ${reason}`, { parse_mode: 'Markdown' });
});

// WhatsApp-dan gələn mesajları Telegram-a ötür
whatsapp.on('message', async (msg) => {
    try {
        if (msg.fromMe) return;
        if (msg.isStatus) return; // Status (Story) paylaşımlarını görməzdən gəl

        const contactInfo = await getContactInfo(msg);
        if (!contactInfo) return;

        const messageType = getMessageType(msg);
        const timestamp = new Date(msg.timestamp * 1000).toLocaleString('az-AZ', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        let messageBody = msg.body;
        if (!messageBody && msg.hasMedia) messageBody = `[${messageType}]`;

        let report = `📨 *Yeni Mesaj*\n⏰ *Vaxt:* ${timestamp}\n`;

        if (contactInfo.isGroup) {
            report += `👥 *Qrup:* ${escapeMarkdown(contactInfo.groupName)}\n` +
                `👤 *Göndərən:* ${escapeMarkdown(contactInfo.name)}\n` +
                `📱 *Nömrə:* \`${contactInfo.phone}\`\n`;
        } else {
            report += `👤 *Kimdən:* ${escapeMarkdown(contactInfo.name)}\n` +
                `📱 *Nömrə:* \`${contactInfo.phone}\`\n`;
            if (contactInfo.isBusiness) report += `🏢 *Biznes hesab*\n`;
        }

        report += `📝 *Tip:* ${messageType}\n📝 *Mesaj:* ${escapeMarkdown(messageBody)}`;

        if (config.settings?.debug_mode) {
            report += `\n🔍 *Debug:* \`${escapeMarkdown(contactInfo.rawFormat)}\``;
        }

        await sendToTelegram(report, { parse_mode: 'Markdown' });

        // Media göndər
        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                if (media && media.data) {
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
                console.error('Media yükləmə xətası:', mediaError.message);
            }
        }

    } catch (error) {
        console.error('Mesaj emalı xətası:', error.message);
        if (error.message.includes('detached Frame') || error.message.includes('Session closed')) {
            console.error('🚨 Kritik brauzer xətası! Bot yenidən başladılır...');
            process.exit(1); // Railway botu avtomatik restart edəcək
        }
    }
});

process.on('uncaughtException', (error) => {
    console.error('Gözlənilməz xəta:', error.message);
    if (error.message.includes('detached Frame') || error.message.includes('Session closed')) {
        process.exit(1);
    }
    sendToTelegram(`🚨 *Kritik xəta:* \`${escapeMarkdown(error.message)}\`\nBot yenidən başladılır...`,
        { parse_mode: 'Markdown' }).then(() => process.exit(1));
});

console.log('🚀 Bot başladılır...');
whatsapp.initialize();