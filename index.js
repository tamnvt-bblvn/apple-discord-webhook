const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const app = express();

app.use(express.json());

const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1481232274241486949/uBQFS80edIYhpRMQ97eGZbPELaLR3jqDNbW0dl0PKRc16jKncXppI870yajLccfkcmU5";

app.post("/apple-webhook", async (req, res) => {
  try {
    const payload = req.body;

    // 1. Xử lý Ping Test
    if (payload.data && payload.data.type === "webhookPingCreated") {
      await axios.post(DISCORD_WEBHOOK_URL, {
        content: "🔔 **Apple Webhook Ping:** Kết nối thành công!",
      });
      return res.status(200).send("OK");
    }

    // 2. Xử lý Dữ liệu giao dịch thật (signedPayload)
    if (payload.signedPayload) {
      // Decode dữ liệu từ Apple
      const decodedPayload = jwt.decode(payload.signedPayload);

      const type = decodedPayload.notificationType;
      const subtype = decodedPayload.subtype || "";
      const env = decodedPayload.data?.environment || "Unknown";

      // Build nội dung gửi sang Discord
      const discordPayload = {
        embeds: [
          {
            title: `🍎 Apple Event: ${type}`,
            description: `Chi tiết: **${subtype}**`,
            color: 3447003,
            fields: [
              { name: "Environment", value: env, inline: true },
              {
                name: "Bundle ID",
                value: decodedPayload.data?.bundleId || "N/A",
                inline: true,
              },
            ],
            timestamp: new Date(),
          },
        ],
      };

      // THỰC HIỆN BẮN SANG DISCORD
      await axios.post(DISCORD_WEBHOOK_URL, discordPayload);

      console.log(`Forwarded ${type} to Discord`);
      return res.status(200).send("Received and Forwarded");
    }

    // Nếu không rơi vào trường hợp nào bên trên
    res.status(400).send("Unknown Payload Format");
  } catch (error) {
    console.error("Lỗi rồi anh ơi:", error.response?.data || error.message);
    res.status(500).send("Internal Error");
  }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
