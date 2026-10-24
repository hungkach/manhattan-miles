// Linking a side phone (0.12.0): a six-letter code, a URL with it for the phone, and a
// peer-to-peer data channel (WebRTC). PeerJS (MIT, loaded on first use from jsdelivr) does the
// handshake through a signaling server, the free public one unless side.peer names another; the
// landmarks then go phone to tablet directly, about 30 small frames a second.
//
//   const host = await RE.sideHost(engine, { onStatus })   // on the tablet: host.code, host.close()
//   const cam = await RE.sideCamera({ code, video, onStatus, onFrame })  // on the phone: cam.stop()
//
// The host measures the phone's clock against its own every two seconds (a ping and its answer;
// the answer with the shortest round trip of the last ten wins) and passes it to side_sync, so
// each side frame lines up with the main frame taken at the same moment.
(function (g) {
  'use strict';
  const RE = g.RepEngine;
  const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
  const PREFIX = 'rep-engine-side-';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

  let loading = null;
  function loadPeer() {
    if (g.Peer) return Promise.resolve(g.Peer);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = g.document.createElement('script');
        s.src = PEERJS;
        s.onload = () => (g.Peer ? resolve(g.Peer) : reject(new Error('The link library did not load')));
        s.onerror = () => { loading = null; reject(new Error('The link library did not load')); };
        g.document.head.appendChild(s);
      });
    }
    return loading;
  }
  RE.sideCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const peerOpts = (cfg) => Object.assign({ debug: 0 }, cfg.side.peer || {});

  // On the tablet: wait for a side phone with this code; its frames go to engine.side_feed.
  // onStatus(text, state): state 'waiting' | 'connected' | 'error'
  RE.sideHost = async function (engine, { code = RE.sideCode(), onStatus = () => {}, config } = {}) {
    const cfg = RE.mergeConfig(RE.defaultConfig(), config);
    const Peer = await loadPeer();
    const peer = new Peer(PREFIX + code, peerOpts(cfg));
    const host = { code, peer, conn: null, rtts: [], timer: 0, closed: false };
    host.close = () => {
      host.closed = true;
      g.clearInterval(host.timer);
      try { if (host.conn) host.conn.close(); } catch (_) {}
      try { peer.destroy(); } catch (_) {}
    };
    peer.on('open', () => onStatus('Waiting for the side phone', 'waiting'));
    peer.on('error', (e) => onStatus(e && e.type === 'unavailable-id' ? 'That code is taken: try another' : 'Link error: ' + (e && (e.type || e.message)), 'error'));
    peer.on('disconnected', () => { if (!host.closed) try { peer.reconnect(); } catch (_) {} });
    peer.on('connection', (conn) => {
      if (host.conn && host.conn !== conn) try { host.conn.close(); } catch (_) {}
      host.conn = conn;
      host.rtts = [];
      conn.on('open', () => {
        onStatus('Side phone connected', 'connected');
        const ping = () => { try { if (conn.open) conn.send({ k: 'ping', t0: RE.now() }); } catch (_) {} };
        ping();
        g.clearInterval(host.timer);
        host.timer = g.setInterval(ping, 2000);
      });
      conn.on('data', (d) => {
        if (!d || typeof d !== 'object') return;
        if (d.k === 'f') engine.side_feed(d.f);
        else if (d.k === 'pong' && typeof d.t0 === 'number' && typeof d.ts === 'number') {
          // the phone's clock: it answered at ts, about half the round trip after t0
          const now = RE.now(), rtt = now - d.t0;
          host.rtts.push({ rtt, offset: d.t0 + rtt / 2 - d.ts });
          while (host.rtts.length > 10) host.rtts.shift();
          const best = host.rtts.reduce((a, b) => (b.rtt < a.rtt ? b : a));
          host.rtt = best.rtt;
          engine.side_sync(best.offset);
        }
      });
      conn.on('close', () => { if (host.conn === conn) { host.conn = null; g.clearInterval(host.timer); onStatus('Side phone left', 'waiting'); } });
    });
    return host;
  };

  // On the phone: open the camera and the tracker, link to the tablet's code, send each frame.
  // opts.source: a frame source for tests ({ start(video, preset, onFrame, onStatus), stop() }).
  // zone(): the stance box room the player set on the phone, in fists (0.20.0), sent with each frame
  RE.sideCamera = async function ({ code, video, preset = 'living_room', onStatus = () => {}, onFrame, source, config, zone } = {}) {
    const cfg = RE.mergeConfig(RE.defaultConfig(), config);
    const Peer = await loadPeer();
    onStatus('Linking to ' + code);
    const peer = new Peer(undefined, peerOpts(cfg));
    await new Promise((resolve, reject) => { peer.on('open', resolve); peer.on('error', (e) => reject(new Error('Link error: ' + (e && (e.type || e.message))))); });
    const conn = peer.connect(PREFIX + String(code).toUpperCase(), { reliable: false, serialization: 'json' });
    const cam = { peer, conn, sent: 0, src: null, lock: null };
    conn.on('data', (d) => { if (d && d.k === 'ping') try { conn.send({ k: 'pong', t0: d.t0, ts: RE.now() }); } catch (_) {} });
    conn.on('close', () => onStatus('The tablet closed the link', 'error'));
    peer.on('error', (e) => onStatus(e && e.type === 'peer-unavailable' ? 'No tablet with that code' : 'Link error: ' + (e && (e.type || e.message)), 'error'));
    await new Promise((resolve) => conn.on('open', resolve));
    onStatus('Linked. Starting the camera', 'linked');
    // keep the screen on while it sends
    try { if (g.navigator.wakeLock) cam.lock = await g.navigator.wakeLock.request('screen'); } catch (_) {}
    const src = (cam.src = source || new RE.CameraPoseSource(cfg));
    await src.start(video, RE.presets[preset] || RE.presets.living_room, (raw) => {
      const p = RE.sidePack(raw);
      if (p && zone) { const zf = +zone(); if (zf > 0) p.zf = zf; }
      if (p && conn.open) { try { conn.send({ k: 'f', f: p }); cam.sent++; } catch (_) {} }
      if (onFrame) onFrame(raw);
    }, (msg) => onStatus(msg, 'linked'));
    cam.stop = () => {
      try { src.stop(); } catch (_) {}
      try { if (cam.lock) cam.lock.release(); } catch (_) {}
      try { conn.close(); peer.destroy(); } catch (_) {}
    };
    return cam;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
