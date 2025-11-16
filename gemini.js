// gemini.js — Integrasi ke Google Gemini Flash 2.5
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Ambil API Key dari .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Inisialisasi model (pakai Flash 2.5)
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Fungsi utama untuk tanya ke AI
async function askGemini(userText) {
  try {
    const prompt = `
Kamu adalah AI bernama *Mira*, asisten virtual yang ceria, ramah, dan suka membantu.
Gunakan gaya bahasa santai, lucu ringan tapi tetap sopan, dan beri semangat positif pada pengguna.
Jangan jawab terlalu kaku — jadilah teman ngobrol yang menyenangkan 😄

Pesan pengguna:
${userText}
`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error("❌ Error Gemini:", err.message);
    return "Maaf yaa 😅 Mira lagi error sedikit, coba lagi nanti ya~";
  }
}

module.exports = askGemini;
