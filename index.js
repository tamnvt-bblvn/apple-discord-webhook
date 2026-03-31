const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const app = express();

app.use(express.json());

// Cấu hình URL Webhook Discord của anh
const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN";

/**
 * Hàm hỗ trợ giải mã JWT (Apple signedPayload)
 * mà không cần verify signature (để test nhanh và nhẹ)
 */
const decodeApplePayload = (signedPayload) => {
  try {
    return jwt.decode(signedPayload);
  } catch (e) {
    console.error("Lỗi giải mã JWT:", e.message);
    return null;
  }
};

app.post("/apple-webhook", async (req, res) => {
  try {
    const payload = req.body;

    // 1. TRƯỜNG HỢP: Apple Test Webhook (Ping)
    if (payload.data && payload.data.type === "webhookPingCreated") {
      console.log("Apple đang ping test hệ thống!");
      await sendToDiscord({
        title: "🔔 Apple Webhook Connectivity",
        description: "Kết nối thành công! Apple đã 'gõ cửa' server của anh.",
        color: 3447003, // Màu xanh dương
      });
      return res.status(200).send("OK");
    }

    // 2. TRƯỜNG HỢP: Sự kiện giao dịch thật (V2)
    if (payload.signedPayload) {
      const decoded = decodeApplePayload(payload.signedPayload);
      if (!decoded) return res.status(400).send("Invalid Payload");

      const type = decoded.notificationType;
      const subtype = decoded.subtype || "";
      const env = decoded.data?.environment || "Unknown";

      // Giải mã tiếp lớp bên trong để lấy thông tin sản phẩm
      let transactionInfo = {};
      if (decoded.data?.signedTransactionInfo) {
        transactionInfo =
          decodeApplePayload(decoded.data.signedTransactionInfo) || {};
      }

      // Xác định màu sắc cho Discord dựa trên loại event
      let embedColor = 3066993; // Mặc định xanh lá (Thành công)
      if (
        type.includes("FAIL") ||
        type.includes("EXPIRED") ||
        type === "REFUND"
      ) {
        embedColor = 15158332; // Màu đỏ (Cảnh báo/Lỗi)
      } else if (type === "SUBSCRIBED" || type === "DID_RENEW") {
        embedColor = 3066993; // Màu xanh lá
      }

      // Tạo nội dung chi tiết cho Discord
      const discordEmbed = {
        title: `🍎 Apple Billing: ${type}`,
        description: subtype ? `Hành động: **${subtype}**` : "Sự kiện hệ thống",
        color: embedColor,
        fields: [
          {
            name: "Product ID",
            value: `\`${transactionInfo.productId || "N/A"}\``,
            inline: true,
          },
          { name: "Environment", value: env, inline: true },
          {
            name: "Transaction ID",
            value: transactionInfo.transactionId || "N/A",
            inline: false,
          },
          {
            name: "Bundle ID",
            value: decoded.data?.bundleId || "N/A",
            inline: true,
          },
          {
            name: "Purchase Date",
            value: transactionInfo.purchaseDate
              ? new Date(transactionInfo.purchaseDate).toLocaleString("vi-VN")
              : "N/A",
            inline: false,
          },
        ],
        footer: { text: `Version 2.0 • ID: ${decoded.notificationUUID}` },
        timestamp: new Date(),
      };

      await sendToDiscord(discordEmbed);
      console.log(`Forwarded event ${type} to Discord.`);
      return res.status(200).send("Received");
    }

    // Nếu không thuộc các loại trên
    res.status(400).send("Unsupported format");
  } catch (error) {
    console.error("Lỗi server:", error.message);
    // Luôn trả về 200 để Apple không bắn lại liên tục nếu đây chỉ là lỗi hiển thị
    res.status(200).send("Error logged");
  }
});

/**
 * Hàm gửi dữ liệu sang Discord
 */
async function sendToDiscord(embedData) {
  try {
    await axios.post(
      DISCORD_WEBHOOK_URL,
      {
        username: "Apple Store Notify",
        avatar_url:
          "https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg",
        embeds: [embedData],
      },
      { timeout: 8000 },
    );
  } catch (err) {
    console.error("Không thể gửi sang Discord:", err.message);
  }
}

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`--- Server Forwarder Apple -> Discord ---`);
  console.log(`Đang chạy tại port: ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/apple-webhook`);
});
