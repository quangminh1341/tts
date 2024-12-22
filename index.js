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
let isProcessing = false;
let requestQueue = [];
let greetingEnabled = true; // Trạng thái bật/tắt tính năng chào

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

// Hàm kiểm tra người dùng duy nhất trong tất cả các kênh thoại
function isUserAloneInAllChannels(guild, userId) {
    return guild.channels.cache
        .filter(channel => channel.type === 2) // Chỉ kênh thoại (voice)
        .every(channel => channel.members.every(member => member.id === userId || member.user.bot));
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

// Sự kiện khi bot kết nối
client.once('ready', () => {
    console.log(`Bot đã sẵn sàng! Đăng nhập với tên: ${client.user.tag}`);
    client.user.setActivity('!tts', { type: 'LISTENING' });
});

client.on('voiceStateUpdate', (oldState, newState) => {
    if (newState.member.user.bot) return; // Bỏ qua bot

    const newChannel = newState.channel;
    const guild = newState.guild;

    if (newChannel) {
        // Kiểm tra nếu người dùng là duy nhất trong tất cả các kênh thoại
        if (isUserAloneInAllChannels(guild, newState.member.id)) {
            // Bot tham gia kênh khi người dùng duy nhất
            if (!voiceConnection || voiceConnection.joinConfig.channelId !== newChannel.id) {
                voiceConnection = joinVoiceChannel({
                    channelId: newChannel.id,
                    guildId: newChannel.guild.id,
                    adapterCreator: newChannel.guild.voiceAdapterCreator,
                });
            }

            // Xóa timeout nếu có
            if (leaveTimeout) {
                clearTimeout(leaveTimeout);
                leaveTimeout = null;
            }

            // Đợi 2 giây rồi chào người dùng
            setTimeout(() => greetUser(newState.member), 2000);
        } else if (voiceConnection && voiceConnection.joinConfig.channelId === newChannel.id) {
            setTimeout(() => greetUser(newState.member), 1000);
        }
    }

    // Kiểm tra và rời kênh khi không còn ai
    if (oldState.channel) {
        checkAndLeaveChannel(oldState.channel);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Lấy nội dung sau "!tts"
    const text = message.content.slice(5).trim();
    if (!text) {
        return message.reply('Hãy nhập nội dung để đọc!');
    }

    // Tạo URL âm thanh từ Google TTS
    const url = googleTTS.getAudioUrl(text, {
        lang: 'vi', // Ngôn ngữ ("vi" cho tiếng Việt)
        slow: false, // Tốc độ nói
        host: 'https://translate.google.com',
    });

    // Tham gia kênh thoại của người dùng
    const channel = message.member?.voice.channel;
    if (!channel) {
        return message.reply('Bạn cần tham gia kênh thoại trước!');
    }

    // Rời kênh hiện tại và tham gia kênh mới
    if (voiceConnection && voiceConnection.joinConfig.channelId !== channel.id) {
        voiceConnection.destroy();
        voiceConnection = null;
    }

    voiceConnection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
    });

    // Phát âm thanh
    const player = createAudioPlayer();
    const resource = createAudioResource(url);

    player.play(resource);
    voiceConnection.subscribe(player);

    // Thêm reaction thay vì trả lời bằng văn bản
    message.react('✅');

    // Xóa timeout nếu có khi bot hoạt động
    if (leaveTimeout) {
        clearTimeout(leaveTimeout);
        leaveTimeout = null;
    }

    if (message.content.startsWith('!hello')) {
        const args = message.content.split(' ');
        if (args.length === 2) {
            greetingEnabled = args[1].toLowerCase() === 'on';
            message.reply(`Tính năng chào đã được ${greetingEnabled ? 'bật' : 'tắt'}.`);
        } else {
            message.reply('Dùng !hello on hoặc !hello off để bật/tắt tính năng chào.');
        }
    }
});

client.on('disconnect', () => {
    console.log('Bot bị ngắt kết nối.');
    voiceConnection = null;
    requestQueue = []; // Hủy tất cả yêu cầu trong queue
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
