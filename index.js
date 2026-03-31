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
    if (!discordWebhookUrl) return res.status(200).send("Not mapped");

    const payload = req.body;

    // DEBUG (QUAN TRỌNG)
    console.log("📦 RAW:", JSON.stringify(payload, null, 2));

    if (!payload.data) return res.status(200).send("No data");

    const { type, attributes = {} } = payload.data;

    let title = `🍎 ${appKey.toUpperCase()}`;
    let color = 3447003;
    let fields = [];

    // =========================
    // 🔍 WEBHOOK PING (TEST)
    if (payload.data?.type === "webhookPingCreated") {
      const timestamp = payload.data.attributes?.timestamp;

      embedData.title = `🔍 Webhook Test: ${appKey.toUpperCase()}`;
      embedData.description =
        `Apple vừa gửi ping để kiểm tra webhook\n\n` +
        `🆔 ID: \`${payload.data.id}\`\n` +
        `⏱ Time: ${timestamp || "N/A"}`;

      embedData.color = 3447003; // xanh dương

      await axios.post(discordWebhookUrl, {
        username: "Apple Bot",
        embeds: [
          {
            ...embedData,
            timestamp: new Date(),
            footer: { text: "Apple Webhook Ping" },
          },
        ],
      });

      return res.status(200).send("Ping OK");
    }

    // =========================
    // 📦 BUILD
    // =========================
    if (type === "builds") {
      const state = attributes.processingState;

      title = "📦 Build Update";

      if (state === "VALID") {
        color = 3066993; // xanh
      } else if (state === "FAILED" || state === "INVALID") {
        color = 15158332; // đỏ
      }

      fields = [
        { name: "Trạng thái", value: state || "N/A", inline: true },
        { name: "Version", value: attributes.version || "N/A", inline: true },
        { name: "Build", value: attributes.buildNumber || "N/A", inline: true },
      ];
    }

    // =========================
    // 🚀 APP RELEASE
    // =========================
    else if (type === "appStoreVersions") {
      const state = attributes.appStoreState;

      title = "🚀 App Store Release";

      if (state === "READY_FOR_SALE") {
        color = 3066993;
      } else if (state === "REJECTED") {
        color = 15158332;
      }

      fields = [
        { name: "Trạng thái", value: state || "N/A", inline: true },
        {
          name: "Version",
          value: attributes.versionString || "N/A",
          inline: true,
        },
      ];
    }

    // =========================
    // 🧪 TESTFLIGHT (fallback)
    // =========================
    else if (
      type === "betaBuildLocalizations" ||
      type === "betaGroups" ||
      type === "buildBetaDetails"
    ) {
      title = "🧪 TestFlight Update";

      fields = [{ name: "Type", value: type, inline: true }];
    } else {
      // ignore event rác
      return res.status(200).send("Ignored");
    }

    // =========================
    // 🚀 SEND DISCORD
    // =========================
    await axios.post(discordWebhookUrl, {
      username: "Apple Bot",
      embeds: [
        {
          title,
          color,
          fields,
          timestamp: new Date(),
          footer: { text: "Apple Webhook" },
        },
      ],
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.status(200).send("Error");
  }
});

app.listen(3004, () => console.log("Server API running on port 3004"));
