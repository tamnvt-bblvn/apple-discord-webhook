const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const fs = require("fs");

const app = express();
app.use(express.json());

// Cấu hình ID của Google Sheet (Lấy từ URL của sheet)
const SPREADSHEET_ID = "1O9KGxJuVVQdw6A4QSusxJiGQ9x4sARYHiuecnWgTp0g";
const RANGE = "A2:B"; // Đọc từ cột A đến B, bỏ qua tiêu đề hàng 1

let webhookMapping = {};

// Hàm xác thực và đọc dữ liệu từ Google Sheet
async function refreshMapping() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: "credentials.json", // File anh vừa tải về
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values;
    const newMapping = {};

    if (rows && rows.length) {
      rows.forEach((row, index) => {
        const appKey = row[0]?.trim().toLowerCase();
        const webhookUrl = row[1]?.trim();

        console.log(
          `Dòng ${index + 2}: App=${appKey}, Webhook=${webhookUrl ? "OK" : "Trống"}`,
        );

        if (appKey && webhookUrl) {
          newMapping[appKey] = webhookUrl;
        }
      });
    }

    webhookMapping = newMapping;
    console.log(
      "✅ API: Đã cập nhật mapping từ Google Sheet:",
      Object.keys(webhookMapping),
    );
  } catch (err) {
    console.error("❌ Lỗi Google API:", err.message);
  }
}

// Cập nhật mỗi 1 phút cho máu (API chịu tải tốt hơn link Pub)
setInterval(refreshMapping, 60000);
refreshMapping();

app.post("/apple-webhook", async (req, res) => {
  try {
    let appKey = req.query.app;
    if (!appKey) return res.status(200).send("Missing app param");

    appKey = decodeURIComponent(appKey).replace(/-/g, " ").toLowerCase();
    const discordWebhookUrl = webhookMapping[appKey];

    if (!discordWebhookUrl) {
      console.log(`⚠️ Không thấy mapping cho: ${appKey}`);
      return res.status(200).send("Not mapped");
    }

    // --- PHẦN GIẢI MÃ AN TOÀN ---
    const payload = req.body;
    // Decode lớp 1
    const decoded = jwt.decode(payload.signedPayload) || {};

    // Decode lớp 2 (Nằm trong data.signedTransactionInfo)
    const transactionInfo = decoded.data?.signedTransactionInfo
      ? jwt.decode(decoded.data.signedTransactionInfo)
      : {};

    // Chuẩn bị dữ liệu hiển thị
    const notificationType = decoded.notificationType || "UNKNOWN_EVENT";
    const productId = transactionInfo.productId || "N/A";
    const environment = decoded.data?.environment || "N/A";

    await axios.post(discordWebhookUrl, {
      username: `Apple Store [${appKey}]`,
      embeds: [
        {
          title: `🍎 Thông báo từ ${appKey.toUpperCase()}`,
          description: `Sự kiện: **${notificationType}**`,
          color: 3066993,
          fields: [
            { name: "Sản phẩm", value: productId, inline: true },
            { name: "Môi trường", value: environment, inline: true },
          ],
          timestamp: new Date(),
        },
      ],
    });

    console.log(`🚀 Đã bắn tin thành công cho ${appKey} (${notificationType})`);
    res.status(200).send("OK");
  } catch (error) {
    console.error("Lỗi:", error.message);
    res.status(200).send("Error");
  }
});

app.listen(3004, () => console.log("Server API running on port 3004"));
