/*
 * WhatsApp AI Bot — dengan logging presence & read
 * Kompatibel dengan Baileys v6.7.21
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidDecode,
  getContentType,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const Pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const qrcode = require("qrcode-terminal");
const readline = require("readline");

const sttHandler = require("./stt");
const askGemini = require("./gemini");

const promptUser = (text) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(text, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
};

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  let mode;
  if (!fs.existsSync("./session/creds.json")) {
    mode = await promptUser("🔰 Pilih metode login:\n1. Pairing Code\n2. QR Code\nKetik angka (1/2): ");
  }

  const sock = makeWASocket({
    version,
    logger: Pino({ level: "silent" }),
    printQRInTerminal: mode === "2",
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    markOnlineOnConnect: true,
  });

  sock.decodeJid = (jid) => {
    if (!jid) return jid;
    const decode = jidDecode(jid) || {};
    return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
  };

  if (mode === "1" && !sock.authState.creds.registered) {
    const phone = await promptUser("📱 Masukkan nomor WhatsApp (awali 62): ");
    console.log("⏳ Menghubungkan ke server WhatsApp...");
    await new Promise((r) => setTimeout(r, 4000));

    try {
      const code = await sock.requestPairingCode(phone);
      console.log(`\n✅ KODE PAIRING: ${code}`);
      console.log("Masukkan kode ini di HP kamu ➜ *Perangkat tertaut → Masukkan kode pairing*\n");
    } catch (err) {
      console.error("❌ Gagal pairing:", err.message);
      process.exit(1);
    }
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (mode === "2" && qr) {
      console.clear();
      console.log("📸 Scan QR berikut untuk login:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Bot tersambung ke WhatsApp!");

      // === ALWAYS ONLINE ===
      setInterval(async () => {
        try {
          await sock.sendPresenceUpdate("available");
          console.log(`[${new Date().toLocaleTimeString()}] 🟢 Presence sent: available`);
        } catch (err) {
          console.warn("⚠️ Presence gagal:", err.message);
        }
      }, 25000);

      // === AUTO READ (centang biru global) ===
      sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
          try {
            const jid = msg.key.remoteJid;
            await sock.readMessages([{ key: msg.key }]);
            console.log(`[${new Date().toLocaleTimeString()}] 🔵 Read message from ${jid}`);
          } catch (e) {
            console.warn("⚠️ Auto-read gagal:", e.message);
          }
        }
      });
    } else if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        console.log("❌ Sesi logout. Hapus folder session lalu jalankan ulang.");
      } else {
        console.log("🔁 Reconnecting...");
        startBot();
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // === Event monitor (presence & messages) ===
  sock.ev.on("presence.update", (data) => {
    console.log(`[${new Date().toLocaleTimeString()}] 📡 Presence event:`, data);
  });

  sock.ev.on("messages.update", (updates) => {
    updates.forEach((u) => {
      console.log(`[${new Date().toLocaleTimeString()}] 📨 Message update:`, {
        key: u.key,
        update: u.update,
      });
    });
  });

  // === PESAN MASUK ===
  sock.ev.on("messages.upsert", async (update) => {
    try {
      const msg = update.messages[0];
      if (!msg?.message) return;

      msg.message = Object.keys(msg.message)[0] === "ephemeralMessage"
        ? msg.message.ephemeralMessage.message
        : msg.message;

      const from = msg.key.remoteJid;
      if (from === "status@broadcast") return;

      const parsed = formatMessage(sock, msg);
      const type = Object.keys(msg.message)[0];

      if (type === "audioMessage" || type === "voiceMessage") {
        console.log(`[${new Date().toLocaleTimeString()}] 🎧 Voice note diterima dari ${from}`);
        await sttHandler(sock, msg);
        return;
      }

      if (parsed.text && !msg.key.fromMe) {
        console.log(`[${new Date().toLocaleTimeString()}] 💬 Pertanyaan dari ${from}:`, parsed.text);
        const reply = await askGemini(parsed.text);
        await sock.sendMessage(from, { text: reply }, { quoted: msg });
        console.log(`[${new Date().toLocaleTimeString()}] 🤖 Balasan dikirim ke ${from}`);
      }

    } catch (err) {
      console.error("⚠️ Error handler pesan:", err);
    }
  });

  sock.sendTxt = (jid, text, quoted = null) =>
    sock.sendMessage(jid, { text }, { quoted });
}

startBot();

function formatMessage(sock, m) {
  if (!m) return m;
  if (m.key) {
    m.id = m.key.id;
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.isGroup = m.chat.endsWith("@g.us");
    m.sender = sock.decodeJid(
      m.fromMe ? sock.user.id : m.key.participant || m.participant || m.chat
    );
  }
  if (m.message) {
    m.mtype = getContentType(m.message);
    m.msg = m.mtype === "viewOnceMessage"
      ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)]
      : m.message[m.mtype];
    m.body = m.message.conversation || m.msg.caption || m.msg.text || "";
  }
  m.text = m.body;
  m.reply = (text, chatId = m.chat) =>
    sock.sendMessage(chatId, { text }, { quoted: m });
  return m;
}

const file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(`♻️ File ${__filename} diperbarui`);
  delete require.cache[file];
  require(file);
});
