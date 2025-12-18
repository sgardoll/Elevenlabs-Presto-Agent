import express from "express";
import http from "http";
import WebSocket from "ws";
import recorder from "node-record-lpcm16";
import Speaker from "speaker";
import "dotenv/config";
import { exec } from "child_process";

// --- CONFIGURATION ---
const CONFIG = {
  AGENT_ID: process.env.ELEVENLABS_AGENT_ID,
  API_KEY: process.env.ELEVENLABS_API_KEY,
  SAMPLE_RATE: 16000,
  PORT: 8080,
  THRESHOLDS: {
    IDLE: 500,   // Low threshold: Picks up normal speech when silence
    BARGE: 4000, // High threshold: Needs louder speech to overcome echo
  },
};

const app = express();
app.use(express.json());

// --- STATE MANAGEMENT ---
let state = {
  wsClient: null,
  recording: null,
  speaker: null,
  sessionStatus: "idle", // idle, listening, error
  agentIsSpeaking: false,
  speechDeadline: 0,
};

// --- HELPER FUNCTIONS ---

// Calculate Root Mean Square (Volume) of a 16-bit buffer
function calculateRMS(buffer) {
  let sum = 0;
  // Read 16-bit samples (2 bytes each)
  for (let i = 0; i < buffer.length; i += 2) {
    if (i + 1 < buffer.length) {
      const int = buffer.readInt16LE(i);
      sum += int * int;
    }
  }
  return Math.sqrt(sum / (buffer.length / 2));
}

function cleanup() {
  console.log("Cleaning up resources...");
  
  if (state.recording) {
    state.recording.stop();
    state.recording = null;
  }
  
  if (state.speaker) {
    state.speaker.end(); // Or close() depending on implementation, end() is standard stream
    state.speaker = null;
  }

  if (state.wsClient) {
    if (state.wsClient.readyState === WebSocket.OPEN) {
      state.wsClient.close();
    }
    state.wsClient = null;
  }

  state.agentIsSpeaking = false;
  state.speechDeadline = 0;
  state.sessionStatus = "idle";
}

// Check if SoX is available
function checkSox() {
  return new Promise((resolve, reject) => {
    exec("which sox", (err) => {
      if (err) reject(new Error("SoX not found. Please install SoX (brew install sox / apt-get install sox)."));
      else resolve();
    });
  });
}

// --- ROUTES ---

app.post("/start", async (req, res) => {
  if (state.sessionStatus !== "idle") {
    return res.json({ ok: false, error: "Already running", sessionState: state.sessionStatus });
  }

  if (!CONFIG.AGENT_ID || !CONFIG.API_KEY) {
     return res.status(500).json({ ok: false, error: "Missing Agent ID or API Key in .env" });
  }

  try {
    const socketUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${CONFIG.AGENT_ID}`;
    console.log("Connecting to:", socketUrl);

    state.wsClient = new WebSocket(socketUrl, {
      headers: { "xi-api-key": CONFIG.API_KEY },
    });

    state.wsClient.on("open", () => {
      state.sessionStatus = "listening";
      console.log("WebSocket opened. Starting audio streams...");

      try {
        // Initialize Speaker
        state.speaker = new Speaker({
          channels: 1,
          bitDepth: 16,
          sampleRate: CONFIG.SAMPLE_RATE,
        });

        // Initialize Recording
        state.recording = recorder.record({
          sampleRate: CONFIG.SAMPLE_RATE,
          channels: 1,
          audioType: "raw",
          threshold: 0, 
          recordProgram: "sox",
        });

        state.recording.stream().on("data", (chunk) => {
          if (!state.wsClient || state.wsClient.readyState !== WebSocket.OPEN) return;

          // 1. Check if Agent is speaking
          if (Date.now() > state.speechDeadline) {
            state.agentIsSpeaking = false;
          }

          // 2. Calculate Loudness (RMS)
          const volume = calculateRMS(chunk);

          // 3. Determine Threshold
          const currentThreshold = state.agentIsSpeaking
            ? CONFIG.THRESHOLDS.BARGE
            : CONFIG.THRESHOLDS.IDLE;

          // 4. Gate logic
          if (volume > currentThreshold) {
            const audioMessage = {
              user_audio_chunk: chunk.toString("base64"),
            };
            // Double check connection before sending
            if (state.wsClient && state.wsClient.readyState === WebSocket.OPEN) {
                state.wsClient.send(JSON.stringify(audioMessage));
            }
          }
        });
        
        // Handle recording errors (e.g. process exit)
        state.recording.stream().on("error", (err) => {
            console.error("Recording error:", err);
            cleanup();
        });

        res.json({ ok: true, sessionState: "started" });

      } catch (audioErr) {
        console.error("Audio initialization failed:", audioErr);
        cleanup();
        // Since we already responded (maybe), we can't easily res.json if we were inside an async callback,
        // but here we are inside the sync 'open' handler, so the response hasn't been sent yet? 
        // Actually 'open' is async relative to the request. The request is pending.
        // Wait, 'res.json' is called at the end of 'open'. 
        // We should ensure we don't double respond.
        // In this flow, we haven't responded yet.
      }
    });

    state.wsClient.on("message", (msg) => {
      try {
        const event = JSON.parse(msg);

        if (event.audio_event && event.audio_event.audio_base_64) {
          const audioBuffer = Buffer.from(
            event.audio_event.audio_base_64,
            "base64"
          );

          if (state.speaker) {
            state.speaker.write(audioBuffer);

            state.agentIsSpeaking = true;
            const durationMs = (audioBuffer.length / (CONFIG.SAMPLE_RATE * 2)) * 1000;
            state.speechDeadline = Math.max(Date.now(), state.speechDeadline) + durationMs;
          }
        }
      } catch (err) {
        console.error("Error processing message:", err);
      }
    });

    state.wsClient.on("close", () => {
      console.log("WebSocket closed.");
      cleanup();
    });

    state.wsClient.on("error", (err) => {
      console.error("WebSocket error:", err);
      state.sessionStatus = "error";
      cleanup();
    });

  } catch (err) {
    cleanup();
    return res.json({ ok: false, error: err.message });
  }
});

app.post("/stop", (req, res) => {
  if (state.wsClient) state.wsClient.close();
  cleanup();
  res.json({ ok: true, sessionState: state.sessionStatus });
});

app.get("/status", (req, res) => res.json({ sessionState: state.sessionStatus }));

// --- SERVER STARTUP ---
const server = http.createServer(app);

checkSox()
  .then(() => {
    server.listen(CONFIG.PORT, "0.0.0.0", () => {
      console.log(`Server listening on http://0.0.0.0:${CONFIG.PORT}`);
    });
  })
  .catch((err) => {
    console.error("Startup checks failed:", err.message);
    process.exit(1);
  });

// Graceful Shutdown
process.on("SIGINT", () => {
  console.log("\nSIGINT received. Shutting down...");
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nSIGTERM received. Shutting down...");
  cleanup();
  process.exit(0);
});
