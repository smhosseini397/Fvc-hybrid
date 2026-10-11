const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// سرو کردن index.html
app.use(express.static(path.join(__dirname, 'public')));

function getLocalIPs() {
    const ips = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push(net.address);
            }
        }
    }
    return ips;
}

const SERVER_IPS = getLocalIPs();
console.log('🌐 Server IPs:', SERVER_IPS);

const rooms = {};

wss.on('connection', (ws, req) => {
    ws.id = Math.random().toString(36).slice(2, 10);
    ws.room = null;
    ws.clientIP = req.socket.remoteAddress;
    
    console.log(`🔌 کلاینت جدید: ${ws.id}`);
    
    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'join') {
            ws.room = msg.room;
            ws.name = msg.name;
            rooms[msg.room] = rooms[msg.room] || [];
            
            const existingPeers = rooms[msg.room].map(p => ({
                peerId: p.id,
                name: p.name
            }));
            
            ws.send(JSON.stringify({
                type: 'joined',
                yourId: ws.id,
                peers: existingPeers,
                serverIPs: SERVER_IPS
            }));
            
            rooms[msg.room].forEach(peer => {
                peer.send(JSON.stringify({
                    type: 'peer-joined',
                    peerId: ws.id,
                    name: msg.name
                }));
            });
            
            rooms[msg.room].push(ws);
        }
        
        if (msg.type === 'signal' || msg.type === 'relay') {
            const target = rooms[ws.room]?.find(p => p.id === msg.target);
            if (target) {
                target.send(JSON.stringify({
                    ...msg,
                    from: ws.id,
                    fromName: ws.name
                }));
            }
        }
    });
    
    ws.on('close', () => {
        if (ws.room && rooms[ws.room]) {
            rooms[ws.room] = rooms[ws.room].filter(p => p.id !== ws.id);
            rooms[ws.room].forEach(peer => {
                peer.send(JSON.stringify({
                    type: 'peer-left',
                    peerId: ws.id
                }));
            });
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server ready on port ${PORT}`);
});
