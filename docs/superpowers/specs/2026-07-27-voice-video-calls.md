# Voice Messages and Audio/Video Calls Design

## Scope

- Direct chats support voice messages up to five minutes and 20 MB each.
- Audio and video attachments play inline. A video may be at most 50 MB, while the total attachment batch remains limited to 50 MB.
- Accepted friends can start one-to-one voice and video calls.
- The first release excludes group calls, screen sharing, server-side recording, and call playback.
- The call surface is mounted in the root layout, survives route changes, and can be minimized on desktop and mobile.

## Media and Signaling

- Browsers send media through WebRTC. NestJS never proxies the audio or video stream.
- The existing Socket.IO `/chat` namespace carries only call state, SDP, and ICE candidates.
- The server verifies that both participants belong to the same accepted friendship conversation and permits only one active call per account.
- States cover ringing, accepted, connecting, active, declined, busy, cancelled, missed, completed, and failed calls.
- Terminal states are stored in MySQL and add a compact call record to the direct conversation.

## TURN Security

- `turn.5200918.xyz` must be DNS-only and must not use the Cloudflare proxy.
- Coturn uses REST shared-secret authentication. The shared secret exists only in API and coturn server environment variables.
- The authenticated `/api/social/calls/ice-servers` endpoint returns a short-lived username and HMAC-SHA1 credential, expiring after one hour by default.
- Website HTTPS and WebSocket traffic continue to use `443`. Coturn uses only `3478/TCP`, `3478/UDP`, and `49160-49200/UDP`.
- Port `5349`, TURN over TLS, DTLS, and TCP peer relay remain disabled until a concrete compatibility need appears.

## Production Configuration

Cloudflare DNS:

- Type: `A`
- Name: `turn`
- Content: the VPS public IP
- Proxy status: DNS only

Alibaba Cloud firewall:

- `3478/TCP`
- `3478/UDP`
- `49160-49200/UDP`

Production `.env`:

```dotenv
TURN_HOST=turn.5200918.xyz
TURN_REALM=turn.5200918.xyz
TURN_SECRET=<strong random value generated on the server>
TURN_EXTERNAL_IP=<VPS public IP>
TURN_PORT=3478
TURN_UDP_MIN=49160
TURN_UDP_MAX=49200
TURN_CREDENTIAL_TTL_SECONDS=3600
STUN_URLS=stun:turn.5200918.xyz:3478
```

When the public address is NAT-mapped, set `TURN_EXTERNAL_IP` to `public-ip/private-ip`. Never write the TURN secret to Git, documentation, logs, or chat.

## Browser Compatibility

- Chrome, Edge, and Android prefer Opus WebM recordings.
- Safari and iPhone use MP4/M4A audio when MediaRecorder does not support WebM.
- Camera switching uses `facingMode`. A desktop device without a second camera keeps the current camera and shows an error.
- Microphone, camera, and WebRTC access require HTTPS.

## Resource Boundary

- The coturn container is limited to 96 MB RAM, 0.2 CPU, eight allocations per temporary user, and 80 allocations globally.
- A successful peer-to-peer connection consumes no VPS media bandwidth. Only TURN fallback consumes server ingress and egress.
- The current 2 vCPU, 2 GiB VPS is suitable for a small number of one-to-one calls, not concurrent video conferencing.
