import { API_BASE_URL } from "@/lib/apiClient";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

/* The live call, as a plain object with a start and a stop.
 *
 * Audio goes browser-to-OpenAI over WebRTC rather than through our backend:
 * relaying it would add a round trip to every packet, and a voice call is the
 * one place in this app where 200ms is the difference between a conversation
 * and a radio check. Our server's only job is to mint the short-lived
 * credential that authorises the session - the real API key never reaches the
 * page.
 */

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type CallPhase = "connecting" | "listening" | "speaking" | "ended" | "error";

export type Viseme = { openness: number; width: number };

export type LiveCallHandlers = {
  onPhase: (phase: CallPhase) => void;
  onViseme: (viseme: Viseme) => void;
  onError: (message: string) => void;
  /** Finalised transcript lines, so the call leaves something behind. */
  onTranscript?: (role: "user" | "assistant", text: string) => void;
};

async function mintClientSecret(): Promise<string> {
  let token = getAccessToken();
  let res = await fetch(`${API_BASE_URL}/realtime/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    token = await refreshAccessToken();
    if (!token) throw new Error("Your session expired. Sign in again to start a call.");
    res = await fetch(`${API_BASE_URL}/realtime/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!res.ok) {
    // Only our own deliberate failures get to write the message. Anything
    // else is a framework string - a bare "Not Found" from a route that isn't
    // deployed yet is true, unhelpful, and reads like the app is broken in a
    // way the user could fix.
    const body = await res.json().catch(() => null);
    const ours = res.status === 429 || res.status === 503;
    throw new Error(
      (ours && typeof body?.detail === "string" ? body.detail : null) ??
        "Calls aren't available right now. Try again in a moment.",
    );
  }

  const data = await res.json();
  if (!data.client_secret) throw new Error("Could not start the call.");
  return data.client_secret as string;
}

export class LiveCall {
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private raf = 0;
  private stopped = false;

  constructor(private handlers: LiveCallHandlers) {}

  async start(): Promise<void> {
    this.handlers.onPhase("connecting");

    try {
      const secret = await mintClientSecret();

      // Asked for after the token succeeds, so a user who is going to hit an
      // error doesn't get a microphone prompt first.
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.stopped) return this.teardown();

      const pc = new RTCPeerConnection();
      this.pc = pc;

      pc.addTrack(this.mic.getAudioTracks()[0], this.mic);

      // The remote track is both what we play and what we measure.
      pc.ontrack = (event) => {
        const [stream] = event.streams;
        this.playAndAnalyse(stream);
      };

      pc.onconnectionstatechange = () => {
        if (this.stopped) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          this.handlers.onError("The call dropped.");
          this.handlers.onPhase("error");
        }
      };

      // Data channel carries session events and transcripts alongside audio.
      const channel = pc.createDataChannel("oai-events");
      channel.onmessage = (event) => this.onServerEvent(event.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answer = await fetch(CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/sdp" },
      });

      if (!answer.ok) throw new Error("Could not connect the call.");

      await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
      if (this.stopped) return this.teardown();
      this.handlers.onPhase("listening");
    } catch (err) {
      if (this.stopped) return;
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it in your browser to use the call."
          : err instanceof Error
            ? err.message
            : "Could not start the call.";
      this.handlers.onError(message);
      this.handlers.onPhase("error");
      this.teardown();
    }
  }

  private onServerEvent(raw: string) {
    let event: { type?: string; transcript?: string; delta?: string };
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    // Turn boundaries drive the on-screen state; the analyser drives the mouth.
    if (event.type === "output_audio_buffer.started") this.handlers.onPhase("speaking");
    if (event.type === "output_audio_buffer.stopped") this.handlers.onPhase("listening");

    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      event.transcript
    ) {
      this.handlers.onTranscript?.("user", event.transcript);
    }
    if (event.type === "response.output_audio_transcript.done" && event.transcript) {
      this.handlers.onTranscript?.("assistant", event.transcript);
    }
  }

  /** Play the companion's voice, and read its envelope for the mouth. */
  private playAndAnalyse(stream: MediaStream) {
    const el = new Audio();
    el.srcObject = stream;
    el.autoplay = true;
    this.audioEl = el;
    void el.play().catch(() => {
      // Autoplay policies vary; the call is still connected, it just may need
      // a gesture. The overlay is opened by a click, so this rarely fires.
    });

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    // Created inside an async ontrack callback, which is nowhere near the
    // click that opened the call - so autoplay policy starts it suspended,
    // and a suspended context's analyser returns a buffer of silence forever.
    // That is why the mouth wasn't tracking the voice: it was faithfully
    // animating zero.
    void ctx.resume().catch(() => {});

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    // Low, because the smoothing that makes a spectrum look nice is exactly
    // the smoothing that makes a mouth lag the voice.
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);

    const freq = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    // Speech energy sits low; sibilants and plosives push the top end. The
    // balance between them is what separates a round "oo" from a wide "ee".
    const lowEnd = Math.floor(analyser.frequencyBinCount * 0.12);

    let openness = 0;
    let width = 0.5;

    const tick = () => {
      // Openness comes from the waveform, not the spectrum. RMS over the
      // time domain is the actual loudness envelope of the voice; summing
      // frequency bins measures how much spectral content there is, which
      // stays high through quiet consonants and barely dips between words.
      analyser.getByteTimeDomainData(time);
      let sumSquares = 0;
      for (let i = 0; i < time.length; i++) {
        const sample = (time[i] - 128) / 128;
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / time.length);

      analyser.getByteFrequencyData(freq);
      let low = 0;
      let high = 0;
      for (let i = 0; i < freq.length; i++) {
        if (i < lowEnd) low += freq[i];
        else high += freq[i];
      }
      low /= lowEnd * 255;
      high /= (freq.length - lowEnd) * 255;

      // Speech RMS rarely exceeds ~0.3, so it needs scaling before it reads
      // as a mouth opening rather than a twitch.
      const energy = Math.min(1, rms * 3.6);
      const brightness = high / (low + high + 0.0001);

      // Attack fast, release slower: a mouth that snaps shut between
      // syllables reads as a glitch, one that snaps open reads as speech.
      const target = energy < 0.04 ? 0 : energy;
      openness += (target - openness) * (target > openness ? 0.6 : 0.25);
      width += (Math.min(1, Math.max(0, brightness * 2.2)) - width) * 0.3;

      this.handlers.onViseme({ openness, width });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Disables the outgoing track rather than tearing the stream down, so the
   *  session, the peer connection and the model's sense of the conversation
   *  all survive being muted. */
  setMuted(muted: boolean): void {
    this.mic?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    this.handlers.onPhase("ended");
  }

  private teardown(): void {
    cancelAnimationFrame(this.raf);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.pc = null;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
