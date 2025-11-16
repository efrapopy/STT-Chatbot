// stt.js — Full Version (STT + Gemini + Online + Centang Biru)
const fs = require("fs");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const FormData = require("form-data");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const askGemini = require("./gemini");

ffmpeg.setFfmpegPath(ffmpegPath);

async function handleSTT(sock, msg) {
  try {
    const messageType = Object.keys(msg.message)[0];
    const chatId = msg.key.remoteJid;
    if (messageType !== "audioMessage" && messageType !== "voiceMessage") return;

    console.log(`🎤 Menerima voice note dari ${chatId}`);

    // === STATUS ONLINE ===
    try {
      if (typeof sock.sendPresenceUpdate === "function") {
        await sock.sendPresenceUpdate("available", chatId); // tampil online
      }
    } catch (e) {
      console.warn("⚠️ Gagal kirim presence 'available':", e.message);
    }

    // === STATUS MENGETIK ===
    try {
      await sock.sendPresenceUpdate("composing", chatId);
    } catch {}

    // === DOWNLOAD VN ===
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: null, reuploadRequest: sock.updateMediaMessage }
    );

    const tempOgg = `temp-${Date.now()}.ogg`;
    const tempWav = tempOgg.replace(".ogg", ".wav");
    fs.writeFileSync(tempOgg, buffer);

    // === KONVERSI KE WAV ===
    await new Promise((resolve, reject) => {
      ffmpeg(tempOgg)
        .toFormat("wav")
        .on("end", resolve)
        .on("error", reject)
        .save(tempWav);
    });

    // === KIRIM KE FLASK STT ===
    const formData = new FormData();
    formData.append("file", fs.createReadStream(tempWav));
    const response = await axios.post("http://127.0.0.1:5000/stt", formData, {
      headers: formData.getHeaders(),
    });

    const textResult = response.data.text;
    console.log("🗣️ Hasil STT:", textResult);

    // === KIRIM KE GEMINI ===
    await sock.sendPresenceUpdate("composing", chatId);
    const aiReply = await askGemini(textResult);

    // === BALAS LANGSUNG KE VN ===
    await sock.sendMessage(chatId, { text: aiReply }, { quoted: msg });

    // === CENTANG BIRU (READ RECEIPT) ===
    try {
      const jid = chatId;
      const participant = msg.key.participant || jid;
      const messageId = msg.key.id;

      if (typeof sock.sendReceipt === "function") {
        await sock.sendReceipt(jid, participant, [messageId], "read");
        console.log("✅ sendReceipt(read) dikirim!");
      } else if (typeof sock.sendReadReceipt === "function") {
        await sock.sendReadReceipt(jid, participant, [messageId]);
        console.log("✅ sendReadReceipt dikirim!");
      } else if (typeof sock.readMessages === "function") {
        await sock.readMessages([{ key: msg.key }]);
        console.log("✅ readMessages dikirim!");
      } else {
        console.log("⚠️ Tidak ada fungsi read receipt di instance sock");
      }
    } catch (e) {
      console.warn("⚠️ Gagal kirim centang biru:", e.message);
    }

    // === BERSIHKAN FILE SEMENTARA ===
    try { fs.unlinkSync(tempOgg); } catch {}
    try { fs.unlinkSync(tempWav); } catch {}

    // === STATUS BERHENTI MENGETIK / OFFLINE ===
    try {
      await sock.sendPresenceUpdate("paused", chatId);
      await sock.sendPresenceUpdate("unavailable", chatId);
    } catch {}
  } catch (err) {
    console.error("❌ Error di STT handler:", err);
    try {
      await sock.sendMessage(msg.key.remoteJid, { text: "Maaf, Mira gak bisa dengar dengan jelas 😅" }, { quoted: msg });
    } catch {}
  }
}

module.exports = handleSTT;
