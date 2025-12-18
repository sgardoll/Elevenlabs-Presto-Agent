import express from "express";
import http from "http";
import WebSocket from "ws";
import recorder from "node-record-lpcm16";
import Speaker from "speaker";
import "dotenv/config";

// --- CONFIGURATION ---
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const API_KEY = process.env.ELEVENLABS_API_KEY;
const SAMPLE_RATE = 16000;

const app = express();
app.use(express.json());

let wsClient = null;
let recording = null;
let speaker = null;
let sessionState = "idle";

// --- SMART GATING STATE ---
let agentIsSpeaking = false;
let speechDeadline = 0;

// THRESHOLDS (Tweak these if necessary)
// Low threshold: Picks up normal speech when silence
const THRESHOLD_IDLE = 500;
// High threshold: Needs louder speech (Barge-in) to overcome echo
// If the agent hears itself, INCREASE this value.
const THRESHOLD_BARGE = 4000;

app.post("/start", async (req, res) => {
  if (sessionState !== "idle") {
    return res.json({ ok: false, error: "Already running", sessionState });
  }

  try {
    const socketUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
    console.log("Connecting to:", socketUrl);

    wsClient = new WebSocket(socketUrl, {
      headers: { "xi-api-key": API_KEY },
    });

    wsClient.on("open", () => {
      sessionState = "listening";
      console.log("WebSocket opened.");

      speaker = new Speaker({
        channels: 1,
        bitDepth: 16,
        sampleRate: SAMPLE_RATE,
      });

      recording = recorder.record({
        sampleRate: SAMPLE_RATE,
        channels: 1,
        audioType: "raw",
        threshold: 0, // We handle threshold manually
        recordProgram: "sox",
      });

      recording.stream().on("data", (chunk) => {
        if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;

        // 1. Check if Agent is speaking
        if (Date.now() > speechDeadline) {
          agentIsSpeaking = false;
        }

        // 2. Calculate Loudness (RMS) of this chunk
        const volume = calculateRMS(chunk);

        // 3. Determine which Threshold to use
        // If agent is speaking, we use the High (Barge) threshold to ignore echo
        const currentThreshold = agentIsSpeaking
          ? THRESHOLD_BARGE
          : THRESHOLD_IDLE;

        // 4. Gate logic
        if (volume > currentThreshold) {
          // Valid speech (User or Barge-in) -> Send it
          const audioMessage = {
            user_audio_chunk: chunk.toString("base64"),
          };
          wsClient.send(JSON.stringify(audioMessage));

          // Debugging log (helps you tune thresholds)
          // if (agentIsSpeaking) console.log(`Barge-in detected! Vol: ${volume}`);
        } else {
          // Too quiet (Silence or Echo) -> Drop it
        }
      });

      res.json({ ok: true, sessionState: "started" });
    });

    wsClient.on("message", (msg) => {
      try {
        const event = JSON.parse(msg);

        if (event.audio_event && event.audio_event.audio_base_64) {
          const audioBuffer = Buffer.from(
            event.audio_event.audio_base_64,
            "base64"
          );

          if (speaker) {
            speaker.write(audioBuffer);

            // Mark agent as "Speaking" for the duration of this chunk
            agentIsSpeaking = true;
            const durationMs = (audioBuffer.length / (SAMPLE_RATE * 2)) * 1000;
            // Extend the deadline
            speechDeadline = Math.max(Date.now(), speechDeadline) + durationMs;
          }
        }
      } catch (err) {}
    });

    wsClient.on("close", () => {
      sessionState = "idle";
      cleanup();
    });

    wsClient.on("error", (err) => {
      sessionState = "error";
      console.error(err);
      cleanup();
    });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// Helper: Calculate Root Mean Square (Volume) of a 16-bit buffer
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
  if (recording) {
    recording.stop();
    recording = null;
  }
  if (speaker) {
    speaker.end();
    speaker = null;
  }
  wsClient = null;
  agentIsSpeaking = false;
}

app.post("/stop", (req, res) => {
  if (wsClient) wsClient.close();
  cleanup();
  sessionState = "idle";
  res.json({ ok: true, sessionState });
});

app.get("/status", (req, res) => res.json({ sessionState }));

http.createServer(app).listen(8080, "0.0.0.0", () => {
  console.log("Server listening on http://0.0.0.0:8080");
});
