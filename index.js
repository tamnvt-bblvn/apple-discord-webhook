const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const SPREADSHEET_ID = "1O9KGxJuVVQdw6A4QSusxJiGQ9x4sARYHiuecnWgTp0g";
const RANGE = "A2:B";

let webhookMapping = {};

// =========================
// 📊 LOAD GOOGLE SHEET
// =========================
async function refreshMapping() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: "credentials.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values;
    const newMapping = {};

    rows?.forEach((row) => {
      const appKey = row[0]?.trim().toLowerCase();
      const webhookUrl = row[1]?.trim();
      if (appKey && webhookUrl) {
        newMapping[appKey] = webhookUrl;
      }
    });

    webhookMapping = newMapping;
    console.log("✅ Mapping:", Object.keys(webhookMapping));
  } catch (err) {
    console.error("❌ Google API:", err.message);
  }
}

setInterval(refreshMapping, 60000);
refreshMapping();

// =========================
// 🎯 STATE MAPPING
// =========================
function mapAppState(state) {
  switch (state) {
    case "READY_FOR_SALE":
      return { msg: "🚀 App đã LIVE trên App Store", color: 3066993 };

    case "IN_REVIEW":
    case "WAITING_FOR_REVIEW":
      return { msg: "🔍 Đang được Apple review", color: 3447003 };

    case "READY_FOR_REVIEW":
      return { msg: "📤 Sẵn sàng gửi review", color: 15844367 };

    case "PROCESSING_FOR_APP_STORE":
      return { msg: "⚙️ Apple đang xử lý build", color: 10181046 };

    case "REJECTED":
    case "METADATA_REJECTED":
    case "DEVELOPER_REJECTED":
      return { msg: "❌ Bị Apple từ chối", color: 15158332 };

    case "INVALID_BINARY":
      return { msg: "💣 Build lỗi (invalid binary)", color: 15158332 };

    case "PENDING_DEVELOPER_RELEASE":
      return { msg: "⏳ Chờ dev release", color: 15844367 };

    case "PENDING_APPLE_RELEASE":
      return { msg: "⏳ Apple sẽ tự động release", color: 15844367 };

    default:
      return { msg: `ℹ️ ${state}`, color: 3447003 };
  }
}

// =========================
// 🚀 WEBHOOK
// =========================
app.post("/apple-webhook", async (req, res) => {
  try {
    let appKey = req.query.app;
    if (!appKey) return res.status(200).send("Missing app");

    appKey = decodeURIComponent(appKey).replace(/-/g, " ").toLowerCase();
    const discordWebhookUrl = webhookMapping[appKey];
    if (!discordWebhookUrl) return res.status(200).send("Not mapped");

    const payload = req.body;

    console.log("📦 RAW:", JSON.stringify(payload, null, 2));

    if (!payload.data) return res.status(200).send("No data");

    const { type, attributes = {} } = payload.data;

    let embed = {
      title: `🍎 ${appKey.toUpperCase()}`,
      color: 3447003,
      fields: [],
      timestamp: new Date(),
      footer: { text: "Apple Webhook" },
    };

    // =========================
    // 🔍 PING
    // =========================
    if (type === "webhookPingCreated") {
      embed.title = "🔍 Webhook Test";
      embed.fields = [
        { name: "Status", value: "✅ OK", inline: true },
        {
          name: "Time",
          value: attributes.timestamp || "N/A",
          inline: true,
        },
      ];

      await axios.post(discordWebhookUrl, {
        username: "Apple Bot",
        embeds: [embed],
      });

      return res.status(200).send("Ping OK");
    }

    // =========================
    // 📦 BUILD
    // =========================
    if (type === "builds") {
      const state = attributes.processingState;

      embed.title = "📦 Build Update";

      if (state === "VALID") embed.color = 3066993;
      else if (["FAILED", "INVALID"].includes(state)) embed.color = 15158332;

      embed.fields = [
        { name: "Status", value: state || "N/A", inline: true },
        { name: "Version", value: attributes.version || "N/A", inline: true },
        {
          name: "Build",
          value: attributes.buildNumber || "N/A",
          inline: true,
        },
      ];
    }

    // =========================
    // 🚀 RELEASE
    // =========================
    else if (type === "appStoreVersions") {
      // 🔥 SUPPORT BOTH (IMPORTANT)
      const state = attributes.appStoreState || attributes.appVersionState;

      const mapped = mapAppState(state);

      embed.title = "🚀 App Store Update";
      embed.color = mapped.color;

      embed.fields = [
        { name: "Status", value: mapped.msg, inline: false },
        { name: "Raw", value: state || "N/A", inline: true },
        {
          name: "Version",
          value: attributes.versionString || "N/A",
          inline: true,
        },
      ];
    }

    // =========================
    // 🧪 TESTFLIGHT (optional)
    // =========================
    else if (
      ["betaBuildLocalizations", "betaGroups", "buildBetaDetails"].includes(
        type,
      )
    ) {
      embed.title = "🧪 TestFlight Update";
      embed.fields = [{ name: "Type", value: type, inline: true }];
    } else {
      return res.status(200).send("Ignored");
    }

    // =========================
    // 🚀 SEND DISCORD
    // =========================
    await axios.post(discordWebhookUrl, {
      username: "Apple Bot",
      embeds: [embed],
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.status(200).send("Error");
  }
});

app.listen(3004, () => console.log("🚀 Server running on 3004"));
