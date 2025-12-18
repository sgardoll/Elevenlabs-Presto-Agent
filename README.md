# 🎙️ ElevenLabs Agent with Physical Remote

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![MicroPython](https://img.shields.io/badge/MicroPython-latest-blue.svg)](https://micropython.org/)
[![ElevenLabs](https://img.shields.io/badge/API-ElevenLabs-orange.svg)](https://elevenlabs.io/)

A full-stack conversational AI project that bridges a **Pimoroni Presto** physical remote with the **ElevenLabs Conversational AI WebSocket API**. This setup allows you to control a high-quality AI agent via a touch-sensitive hardware interface while offloading the heavy lifting (audio processing and API communication) to a host server.

---

## 🏗️ Architecture

The system is split into two specialized components:

### 1. Node.js Server (`server.js`)
The "brain" running on your host computer (Mac/PC/Linux).
- **Audio Processing:** Uses `sox` and `node-record-lpcm16` for low-latency recording.
- **Playback:** Uses `speaker` for real-time PCM audio streaming.
- **Gating Logic:** Implements custom RMS-based gating to handle **Barge-in** and echo cancellation (so the agent doesn't trigger itself).
- **API Bridge:** Manages the persistent WebSocket connection to ElevenLabs.
- **Control Interface:** Provides a lightweight HTTP API (`/start`, `/stop`, `/status`) for the remote.

### 2. MicroPython Remote (`main.py`)
The "controller" running on a **Pimoroni Presto**.
- **UI:** A visual dashboard showing session states: `IDLE`, `STARTING`, `ACTIVE`, and `OFFLINE`.
- **Interaction:** Single-touch toggle to start or stop conversations.
- **Connectivity:** Low-power WiFi communication with the host server.

---

## 🚀 Getting Started

### Prerequisites

#### Host Computer (Server)
- **Node.js** (v18 or higher)
- **SoX (Sound eXchange)**: Required for system-level audio recording.
  - **macOS**: `brew install sox`
  - **Linux**: `sudo apt-get install sox`
  - **Windows**: [Download binaries](http://sox.sourceforge.net/) and add to PATH.
- **ElevenLabs API Key**: Available in your [ElevenLabs Dashboard](https://elevenlabs.io/app/settings/api-keys).

#### Hardware
- **Pimoroni Presto** (or a similar MicroPython-compatible device with a screen).

---

## 🛠️ Installation & Setup

### 1. Clone & Install Server
```bash
git clone https://github.com/your-username/elevenlabs-agent.git
cd elevenlabs-agent
npm install
```

### 2. Configure the Server
Create a `.env` file in the root directory (you can copy `.env.example`):
```bash
cp .env.example .env
```
Open `.env` and add your ElevenLabs credentials:
- `ELEVENLABS_AGENT_ID`: Your Agent ID.
- `ELEVENLABS_API_KEY`: Your ElevenLabs API Key.

### 3. Configure the Remote
Create a `secrets.py` file (you can use `secrets.py.example` as a template) and upload it to your Presto:
- `WIFI_SSID`: Your WiFi network name.
- `WIFI_PASS`: Your WiFi password.
- `AGENT_SERVER_IP`: The local IP address of your host computer.

### 4. Deploy to Presto
Use [Thonny](https://thonny.org/) or `mpremote` to flash `main.py` and `secrets.py` onto your Pimoroni Presto.

---

## 🏃 Running the Project

1. **Start the Host Server:**
   ```bash
   node server.js
   ```
   You should see `Server listening on http://0.0.0.0:8080`.

2. **Power on the Presto:**
   It will connect to WiFi and display the `IDLE` state. Tap the screen to begin a conversation!

---

## ⚙️ Advanced Configuration

### Audio Thresholds
If the agent is too sensitive or doesn't hear you over its own voice, tweak these in `server.js`:
- `THRESHOLD_IDLE`: Sensitivity when the room is quiet.
- `THRESHOLD_BARGE`: Sensitivity required to interrupt the agent while it is speaking.

### Audio Settings
Defaults to `16000Hz` mono, 16-bit PCM. This is the optimal format for ElevenLabs Conversational AI.

---

## 🤝 Contributing

Forks and Pull Requests are welcome! 
1. **Fork** the Repo.
2. **Create** a Feature Branch (`git checkout -b feature/AmazingFeature`).
3. **Commit** your changes (`git commit -m 'Add some AmazingFeature'`).
4. **Push** to the Branch (`git push origin feature/AmazingFeature`).
5. **Open** a Pull Request.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information. (Note: Ensure you include a LICENSE file if forking).

---

## 🙏 Acknowledgments
- [ElevenLabs](https://elevenlabs.io/) for the Conversational AI API.
- [Pimoroni](https://pimoroni.com/) for the excellent Presto hardware.
