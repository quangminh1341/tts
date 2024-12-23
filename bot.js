const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
require('dotenv').config();
const express = require('express');
const http = require('http');

// Tạo client Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Lưu trữ kết nối voice và timeout rời kênh
let voiceConnection = null;
let leaveTimeout = null;
let greetingEnabled = true; // Trạng thái bật/tắt tính năng chào
let isProcessing = false; // Trạng thái xử lý yêu cầu !tts

// Hàm kiểm tra kênh trống và rời đi
function checkAndLeaveChannel(channel) {
    if (!channel || channel.members.size === 1) { // Chỉ còn bot
        leaveTimeout = setTimeout(() => {
            if (voiceConnection) {
                console.log("Không còn ai trong kênh, bot rời đi.");
                voiceConnection.destroy();
                voiceConnection = null;
            }
        }, 180000); // 3 phút
    }
}

// Hàm phát lời chào tới người dùng
function greetUser(member) {
    if (!greetingEnabled) return; // Kiểm tra nếu tính năng chào đã bị tắt

    const displayName = member.displayName;
    let messageText;

    // Kiểm tra ID người dùng cụ thể
    if (member.id === '389350643090980869') {
        messageText = `Xin chào sếp Quang Minh đã trở lại!`;
    } else {
        messageText = `Xin chào ${displayName} đã tham gia!`;
    }

    const url = googleTTS.getAudioUrl(messageText, {
        lang: 'vi',
        slow: false,
        host: 'https://translate.google.com',
    });

    const player = createAudioPlayer();
    const resource = createAudioResource(url);

    player.play(resource);
    voiceConnection.subscribe(player);
}

// Hàm chia nhỏ văn bản
function splitText(text, maxLength) {
    const words = text.split(' ');
    const chunks = [];
    let currentChunk = '';

    for (const word of words) {
        if ((currentChunk + word).length > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
        }
        currentChunk += ` ${word}`;
    }

    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

// Sự kiện khi bot kết nối
client.once('ready', () => {
    console.log(`Bot đã sẵn sàng! Đăng nhập với tên: ${client.user.tag}`);
    client.user.setActivity('!tts', { type: 'LISTENING' });
});

client.on('voiceStateUpdate', (oldState, newState) => {
    if (voiceConnection && !newState.channel && newState.id === client.user.id) {
        // Bot bị kick hoặc rời khỏi kênh
        console.log('Bot bị kick hoặc mất kết nối khỏi kênh.');
        if (voiceConnection) {
            voiceConnection.destroy();
        }
        voiceConnection = null;
        isProcessing = false; // Reset trạng thái xử lý
    }

    if (newState.member.user.bot) return;

    const newChannel = newState.channel;
    if (newChannel) {
        if (!voiceConnection || voiceConnection.joinConfig.channelId !== newChannel.id) {
            voiceConnection = joinVoiceChannel({
                channelId: newChannel.id,
                guildId: newChannel.guild.id,
                adapterCreator: newChannel.guild.voiceAdapterCreator,
            });
        }

        if (leaveTimeout) {
            clearTimeout(leaveTimeout);
            leaveTimeout = null;
        }

        setTimeout(() => greetUser(newState.member), 2000);
    }

    if (oldState.channel) {
        checkAndLeaveChannel(oldState.channel);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!hello')) {
        const args = message.content.split(' ');
        if (args.length === 2) {
            greetingEnabled = args[1].toLowerCase() === 'on';
            message.reply(`Tính năng chào đã được ${greetingEnabled ? 'bật' : 'tắt'}.`);
        } else {
            message.reply('Dùng !hello on hoặc !hello off để bật/tắt tính năng chào.');
        }
        return;
    }

    if (!message.content.startsWith('!tts')) return; // Chỉ phản hồi nếu tin nhắn bắt đầu bằng !tts

    if (isProcessing) {
        message.reply('Bot đang xử lý yêu cầu trước. Vui lòng đợi!');
        return;
    }

    isProcessing = true;

    const text = message.content.slice(4).trim(); // Bỏ !tts
    if (!text) {
        isProcessing = false;
        return message.reply('Hãy nhập nội dung để đọc!');
    }

    const channel = message.member?.voice.channel;
    if (!channel) {
        isProcessing = false;
        return message.reply('Bạn cần tham gia kênh thoại trước!');
    }

    if (voiceConnection && voiceConnection.joinConfig.channelId !== channel.id) {
        voiceConnection.destroy();
        voiceConnection = null;
    }

    voiceConnection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
    });

    try {
        const chunks = splitText(text, 200);
        for (const chunk of chunks) {
            if (!voiceConnection) {
                throw new Error('Voice connection lost');
            }

            const url = googleTTS.getAudioUrl(chunk, {
                lang: 'vi',
                slow: false,
                host: 'https://translate.google.com',
            });

            const player = createAudioPlayer();
            const resource = createAudioResource(url);

            player.play(resource);
            voiceConnection.subscribe(player);

            await new Promise((resolve, reject) => {
                player.on('idle', resolve);
                player.on('error', reject);

                if (!voiceConnection) {
                    reject(new Error('Voice connection lost'));
                }
            });
        }
    } catch (error) {
        console.error('Lỗi khi phát âm thanh:', error);
        isProcessing = false; // Reset trạng thái xử lý nếu gặp lỗi
        message.reply('Đã xảy ra lỗi khi phát âm thanh. Vui lòng thử lại!');
    }

    isProcessing = false;
    message.react('✅');

    if (leaveTimeout) {
        clearTimeout(leaveTimeout);
        leaveTimeout = null;
    }
});

client.on('disconnect', () => {
    console.log('Bot bị ngắt kết nối.');
    voiceConnection = null;
    isProcessing = false; // Reset trạng thái xử lý
});

// Tạo server HTTP
const port = 3000;
const app = express();
const server = http.createServer(app);

// Khởi động server
server.listen(port, () => {
    console.log(`Server đang chạy trên http://localhost:${port}`);
});


client.login(process.env.TOKEN);
