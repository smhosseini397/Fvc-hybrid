/**
 * FVC Signaling Server - Cloudflare Worker + Durable Objects
 * هر اتاق یه Durable Object جداگانه داره
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get("Upgrade");

    // اگه WebSocket درخواست بود
    if (upgradeHeader === "websocket") {
      // اسم اتاق رو از query param بگیر
      const roomName = url.searchParams.get("room") || "default";

      // به Durable Object مربوطه وصل شو
      const id = env.ROOMS.idFromName(roomName);
      const roomObject = env.ROOMS.get(id);

      // درخواست رو به Durable Object پاس بده
      return roomObject.fetch(request);
    }

    // صفحه‌ی اصلی (health check)
    return new Response(
      JSON.stringify({
        status: "ok",
        service: "FVC Signaling Server (Durable Objects)",
        time: new Date().toISOString(),
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  },
};

/**
 * Durable Object: هر اتاق یه instance جداگانه
 */
export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.peers = []; // لیست peerهای متصل به این اتاق
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    const peerId = Math.random().toString(36).slice(2, 10);
    let peerName = null;

    // لیست peerهای موجود رو به این peer جدید بفرست
    const existingPeers = this.peers.map((p) => ({
      peerId: p.id,
      name: p.name,
    }));

    server.send(
      JSON.stringify({
        type: "joined",
        yourId: peerId,
        peers: existingPeers,
      })
    );

    // به بقیه بگو یکی اومد (بعد از اینکه اسمش رو فهمیدیم)

    server.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);

        // ===== ثبت نام peer =====
        if (msg.type === "join") {
          peerName = msg.name;

          // این peer رو به لیست اضافه کن
          this.peers.push({ id: peerId, name: peerName, ws: server });

          // به بقیه بگو یکی اومد
          this.peers.forEach((p) => {
            if (p.id !== peerId) {
              p.ws.send(
                JSON.stringify({
                  type: "peer-joined",
                  peerId: peerId,
                  name: peerName,
                })
              );
            }
          });

          return;
        }

        // ===== پیام signaling یا relay =====
        if (msg.type === "signal" || msg.type === "relay") {
          const target = this.peers.find((p) => p.id === msg.target);
          if (target) {
            target.ws.send(
              JSON.stringify({
                ...msg,
                from: peerId,
                fromName: peerName,
              })
            );
          }
        }
      } catch (e) {
        console.error("Error:", e);
      }
    });

    server.addEventListener("close", () => {
      // این peer رو از لیست پاک کن
      this.peers = this.peers.filter((p) => p.id !== peerId);

      // به بقیه بگو یکی رفت
      this.peers.forEach((p) => {
        p.ws.send(
          JSON.stringify({
            type: "peer-left",
            peerId: peerId,
          })
        );
      });
    });

    server.addEventListener("error", (err) => {
      console.error("WS Error:", err);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}