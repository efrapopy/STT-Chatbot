require("dotenv").config();
const axios = require("axios");

(async () => {
  try {
    const res = await axios.get(
      `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`
    );

    console.log("📦 Daftar Model Gemini:");
    res.data.models.forEach((m) => console.log("•", m.name));
  } catch (err) {
    console.error("❌ Gagal ambil model:", err.response?.data || err.message);
  }
})();
