"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Camera,
  CameraOff,
  LoaderCircle,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneCall,
  PhoneOff,
  RefreshCw,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  getCallIceServers,
  type CallSession,
  type CallType,
  type Conversation,
} from "@/lib/social-api";
import { getAvatarFallbackText } from "@/lib/user-display";
import { useLanguage } from "@/components/language-provider";

type CallPhase = "incoming" | "outgoing" | "connecting" | "active" | "ending";

interface CallState {
  call: CallSession;
  phase: CallPhase;
  minimized: boolean;
  muted: boolean;
  cameraEnabled: boolean;
  facingMode: "user" | "environment";
}

interface CallAck {
  ok: boolean;
  call?: CallSession;
  error?: string;
}

interface CallSignal {
  type: "offer" | "answer" | "ice-candidate";
  sdp?: string;
  candidate?: RTCIceCandidateInit | null;
}

interface UseChatCallsOptions {
  socket: Socket | null;
  userId: number;
  selected: Conversation | null;
  onIncoming: (call: CallSession) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function useChatCalls({ socket, userId, selected, onIncoming, onError, onNotice }: UseChatCallsOptions) {
  const { locale, phrase } = useLanguage();
  const [state, setState] = useState<CallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const stateRef = useRef<CallState | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const iceConfigRef = useRef<{ iceServers: RTCIceServer[]; expiresAt: number } | null>(null);
  const requestedFullscreenRef = useRef(false);
  const fullscreenRequestVersionRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const disposeMedia = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    pendingCandidatesRef.current = [];
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const requestVideoFullscreen = useCallback(() => {
    if (typeof document === "undefined" || document.fullscreenElement) return;
    const requestFullscreen = document.documentElement.requestFullscreen;
    if (!requestFullscreen) return;
    const requestVersion = fullscreenRequestVersionRef.current + 1;
    fullscreenRequestVersionRef.current = requestVersion;
    requestedFullscreenRef.current = true;
    void requestFullscreen.call(document.documentElement)
      .then(() => {
        if (fullscreenRequestVersionRef.current === requestVersion && requestedFullscreenRef.current) return;
        if (document.fullscreenElement === document.documentElement && document.exitFullscreen) {
          void document.exitFullscreen().catch(() => {});
        }
      })
      .catch(() => {
        if (fullscreenRequestVersionRef.current === requestVersion) requestedFullscreenRef.current = false;
      });
  }, []);

  const exitVideoFullscreen = useCallback(() => {
    if (!requestedFullscreenRef.current || typeof document === "undefined") return;
    fullscreenRequestVersionRef.current += 1;
    requestedFullscreenRef.current = false;
    if (!document.fullscreenElement || !document.exitFullscreen) return;
    void document.exitFullscreen().catch(() => {});
  }, []);

  const clearCall = useCallback(() => {
    disposeMedia();
    exitVideoFullscreen();
    stateRef.current = null;
    setState(null);
    setIsPreparing(false);
  }, [disposeMedia, exitVideoFullscreen]);

  const getIceConfig = useCallback(async (): Promise<RTCIceServer[]> => {
    const cached = iceConfigRef.current;
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.iceServers;
    const token = readAccessToken();
    if (!token) throw new Error(phrase("登录状态已失效。", "Sign-in has expired."));
    const config = await getCallIceServers(token);
    iceConfigRef.current = {
      iceServers: config.iceServers,
      expiresAt: config.expiresAt ? new Date(config.expiresAt).getTime() : Date.now() + 5 * 60_000,
    };
    return config.iceServers;
  }, [phrase]);

  const emitSignal = useCallback((callId: number, signal: CallSignal) => {
    socket?.emit("call:signal", { callId, signal });
  }, [socket]);

  const ensurePeerConnection = useCallback(async (call: CallSession): Promise<RTCPeerConnection> => {
    if (peerConnectionRef.current) return peerConnectionRef.current;
    const stream = localStreamRef.current;
    if (!stream) throw new Error(phrase("本地媒体设备尚未就绪。", "Local media devices are not ready."));
    const peer = new RTCPeerConnection({ iceServers: await getIceConfig() });
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      emitSignal(call.id, {
        type: "ice-candidate",
        candidate: event.candidate?.toJSON() ?? null,
      });
    };
    peer.ontrack = (event) => {
      const incoming = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStream(incoming);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        socket?.emit("call:connected", { callId: call.id });
        setState((current) => current?.call.id === call.id ? { ...current, phase: "active" } : current);
      } else if (peer.connectionState === "failed") {
        socket?.emit("call:end", { callId: call.id, reason: "failed" });
      }
    };
    peerConnectionRef.current = peer;
    return peer;
  }, [emitSignal, getIceConfig, phrase, socket]);

  const flushCandidates = useCallback(async (peer: RTCPeerConnection) => {
    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  }, []);

  const handleSignal = useCallback(async (payload: { callId: number; signal: CallSignal }) => {
    const current = stateRef.current;
    if (!current || current.call.id !== payload.callId) return;
    try {
      const peer = await ensurePeerConnection(current.call);
      if (payload.signal.type === "offer" && payload.signal.sdp) {
        await peer.setRemoteDescription({ type: "offer", sdp: payload.signal.sdp });
        await flushCandidates(peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        emitSignal(current.call.id, { type: "answer", sdp: answer.sdp });
        setState((value) => value?.call.id === current.call.id ? { ...value, phase: "connecting" } : value);
        return;
      }
      if (payload.signal.type === "answer" && payload.signal.sdp) {
        await peer.setRemoteDescription({ type: "answer", sdp: payload.signal.sdp });
        await flushCandidates(peer);
        return;
      }
      if (payload.signal.type === "ice-candidate" && payload.signal.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(payload.signal.candidate);
        else pendingCandidatesRef.current.push(payload.signal.candidate);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : phrase("媒体连接失败。", "Media connection failed."));
      socket?.emit("call:end", { callId: current.call.id, reason: "failed" });
    }
  }, [emitSignal, ensurePeerConnection, flushCandidates, onError, phrase, socket]);

  useEffect(() => {
    if (!socket || !userId) return;
    const incoming = (call: CallSession) => {
      if (stateRef.current) return;
      const next: CallState = {
        call,
        phase: "incoming",
        minimized: false,
        muted: false,
        cameraEnabled: call.type === "video",
        facingMode: "user",
      };
      stateRef.current = next;
      setState(next);
      onIncoming(call);
    };
    const accepted = (call: CallSession) => {
      const current = stateRef.current;
      if (!current || current.call.id !== call.id || call.callerId !== userId) return;
      const next = { ...current, call, phase: "connecting" as const };
      stateRef.current = next;
      setState(next);
      void (async () => {
        try {
          const peer = await ensurePeerConnection(call);
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          emitSignal(call.id, { type: "offer", sdp: offer.sdp });
        } catch (error) {
          onError(error instanceof Error ? error.message : phrase("无法建立通话连接。", "Could not establish the call connection."));
          socket.emit("call:end", { callId: call.id, reason: "failed" });
        }
      })();
    };
    const claimed = (payload: { call: CallSession; acceptedBySocketId: string }) => {
      const current = stateRef.current;
      if (!current || current.call.id !== payload.call.id || current.phase !== "incoming") return;
      if (payload.acceptedBySocketId !== socket.id) {
        clearCall();
        return;
      }
      const next = { ...current, call: payload.call, phase: "connecting" as const };
      stateRef.current = next;
      setState(next);
    };
    const active = (call: CallSession) => {
      const current = stateRef.current;
      if (!current || current.call.id !== call.id) return;
      const next = { ...current, call, phase: "active" as const };
      stateRef.current = next;
      setState(next);
    };
    const ended = (call: CallSession) => {
      if (stateRef.current?.call.id !== call.id) return;
      clearCall();
      onNotice(callEndNotice(call, locale));
    };
    const disconnected = () => {
      if (!stateRef.current) return;
      clearCall();
      onError(phrase("聊天连接已断开，当前通话已结束。", "Chat connection was lost and the current call ended."));
    };
    socket.on("call:incoming", incoming);
    socket.on("call:accepted", accepted);
    socket.on("call:claimed", claimed);
    socket.on("call:signal", handleSignal);
    socket.on("call:active", active);
    socket.on("call:ended", ended);
    socket.on("disconnect", disconnected);
    return () => {
      socket.off("call:incoming", incoming);
      socket.off("call:accepted", accepted);
      socket.off("call:claimed", claimed);
      socket.off("call:signal", handleSignal);
      socket.off("call:active", active);
      socket.off("call:ended", ended);
      socket.off("disconnect", disconnected);
    };
  }, [clearCall, emitSignal, ensurePeerConnection, handleSignal, locale, onError, onIncoming, onNotice, phrase, socket, userId]);

  useEffect(() => () => disposeMedia(), [disposeMedia]);

  const acquireMedia = useCallback(async (type: CallType, facingMode: "user" | "environment") => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(phrase("当前浏览器不支持音视频通话。", "This browser does not support audio or video calls."));
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: type === "video" ? {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      } : false,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, [phrase]);

  const startCall = useCallback(async (type: CallType) => {
    if (!socket?.connected || !selected || stateRef.current || isPreparing) return;
    setIsPreparing(true);
    try {
      if (type === "video") requestVideoFullscreen();
      await acquireMedia(type, "user");
      const response = await socket.timeout(12_000).emitWithAck("call:start", {
        conversationId: selected.id,
        type,
      }) as CallAck;
      if (!response.ok || !response.call) throw new Error(response.error || phrase("通话发起失败。", "Could not start the call."));
      const next: CallState = {
        call: response.call,
        phase: "outgoing",
        minimized: false,
        muted: false,
        cameraEnabled: type === "video",
        facingMode: "user",
      };
      stateRef.current = next;
      setState(next);
    } catch (error) {
      disposeMedia();
      if (type === "video") exitVideoFullscreen();
      onError(error instanceof Error ? error.message : phrase("通话发起失败。", "Could not start the call."));
    } finally {
      setIsPreparing(false);
    }
  }, [acquireMedia, disposeMedia, exitVideoFullscreen, isPreparing, onError, phrase, requestVideoFullscreen, selected, socket]);

  const acceptCall = useCallback(async () => {
    const current = stateRef.current;
    if (!socket?.connected || !current || current.phase !== "incoming" || isPreparing) return;
    setIsPreparing(true);
    try {
      if (current.call.type === "video") requestVideoFullscreen();
      await acquireMedia(current.call.type, current.facingMode);
      const response = await socket.timeout(12_000).emitWithAck("call:respond", {
        callId: current.call.id,
        accepted: true,
      }) as CallAck;
      if (!response.ok || !response.call) throw new Error(response.error || phrase("接听失败。", "Could not accept the call."));
      const next = { ...current, call: response.call, phase: "connecting" as const };
      stateRef.current = next;
      setState(next);
    } catch (error) {
      disposeMedia();
      if (current.call.type === "video") exitVideoFullscreen();
      socket.emit("call:respond", { callId: current.call.id, accepted: false });
      onError(error instanceof Error ? error.message : phrase("无法使用麦克风或摄像头。", "Could not access the microphone or camera."));
    } finally {
      setIsPreparing(false);
    }
  }, [acquireMedia, disposeMedia, exitVideoFullscreen, isPreparing, onError, phrase, requestVideoFullscreen, socket]);

  const declineCall = useCallback(() => {
    const current = stateRef.current;
    if (!socket || !current) return;
    socket.emit("call:respond", { callId: current.call.id, accepted: false });
    clearCall();
  }, [clearCall, socket]);

  const endCall = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    setState((value) => value ? { ...value, phase: "ending" } : value);
    exitVideoFullscreen();
    if (socket?.connected) socket.emit("call:end", { callId: current.call.id });
    else clearCall();
  }, [clearCall, exitVideoFullscreen, socket]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !stateRef.current?.muted;
    stream.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setState((current) => current ? { ...current, muted: nextMuted } : current);
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextEnabled = !stateRef.current?.cameraEnabled;
    stream.getVideoTracks().forEach((track) => { track.enabled = nextEnabled; });
    setState((current) => current ? { ...current, cameraEnabled: nextEnabled } : current);
  }, []);

  const switchCamera = useCallback(async () => {
    const current = stateRef.current;
    const stream = localStreamRef.current;
    const peer = peerConnectionRef.current;
    if (!current || current.call.type !== "video" || !stream) return;
    const nextFacingMode = current.facingMode === "user" ? "environment" : "user";
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const nextTrack = replacement.getVideoTracks()[0];
      if (!nextTrack) throw new Error(phrase("没有找到可切换的摄像头。", "No camera is available to switch to."));
      const oldTrack = stream.getVideoTracks()[0];
      const sender = peer?.getSenders().find((item) => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(nextTrack);
      if (oldTrack) {
        stream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      stream.addTrack(nextTrack);
      const nextStream = new MediaStream(stream.getTracks());
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      setState((value) => value ? { ...value, facingMode: nextFacingMode, cameraEnabled: true } : value);
    } catch (error) {
      onError(error instanceof Error ? error.message : phrase("摄像头切换失败。", "Could not switch camera."));
    }
  }, [onError, phrase]);

  const setMinimized = useCallback((minimized: boolean) => {
    setState((current) => current ? { ...current, minimized } : current);
  }, []);

  return {
    state,
    localStream,
    remoteStream,
    isPreparing,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    setMinimized,
    clearCall,
  };
}

export function ChatCallPanel({
  state,
  localStream,
  remoteStream,
  isPreparing,
  onAccept,
  onDecline,
  onEnd,
  onToggleMute,
  onToggleCamera,
  onSwitchCamera,
  onMinimize,
}: {
  state: CallState | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isPreparing: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onMinimize: (minimized: boolean) => void;
}) {
  const { locale, phrase } = useLanguage();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteMediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream, state?.minimized]);

  useEffect(() => {
    if (remoteMediaRef.current) remoteMediaRef.current.srcObject = remoteStream;
  }, [remoteStream, state?.minimized]);

  useEffect(() => {
    if (state?.phase !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state?.phase]);

  if (!state) return null;
  const avatar = state.call.user.avatarUrl ? resolveApiUrl(state.call.user.avatarUrl) : null;
  const duration = state.call.acceptedAt
    ? formatDuration(Math.max(0, Math.floor((now - new Date(state.call.acceptedAt).getTime()) / 1000)))
    : "";
  const label = state.call.type === "video" ? phrase("视频通话", "Video call") : phrase("语音通话", "Voice call");

  if (state.minimized) {
    return <button className="chat-call-mini" onClick={() => onMinimize(false)} title={phrase("返回通话", "Return to call")} type="button"><PhoneCall aria-hidden="true" size={18} /><span><strong>{state.call.user.nickname}</strong><small>{state.phase === "active" ? duration : phaseText(state.phase, locale)}</small></span></button>;
  }

  return <section className={`chat-call-panel ${state.call.type}`} aria-label={phrase(`${label}窗口`, `${label} panel`)}>
    <div className="chat-call-media">
      {state.call.type === "video" ? <video autoPlay className="chat-call-remote-video" playsInline ref={remoteMediaRef as RefObject<HTMLVideoElement>} /> : <audio autoPlay ref={remoteMediaRef as RefObject<HTMLAudioElement>} />}
      {state.call.type === "voice" || !remoteStream ? <div className="chat-call-identity">
        <span className="chat-call-avatar">{avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText(state.call.user)}</span>
        <strong>{state.call.user.nickname}</strong>
        <span>{state.phase === "active" ? duration : phaseText(state.phase, locale)}</span>
      </div> : null}
      {state.call.type === "video" && localStream ? <video autoPlay className="chat-call-local-video" muted playsInline ref={localVideoRef} /> : null}
    </div>
    <header><span>{label}</span>{state.phase === "active" ? <time>{duration}</time> : null}</header>
    {state.phase === "incoming" ? <div className="chat-call-incoming-actions">
      <button aria-label={phrase("拒绝通话", "Decline call")} className="danger" onClick={onDecline} title={phrase("拒绝", "Decline")} type="button"><PhoneOff aria-hidden="true" size={22} /></button>
      <button aria-label={phrase("接听通话", "Accept call")} className="accept" disabled={isPreparing} onClick={onAccept} title={isPreparing ? phrase("正在准备媒体设备", "Preparing media devices") : phrase("接听", "Accept")} type="button">{isPreparing ? <LoaderCircle aria-hidden="true" className="spin" size={22} /> : <Phone aria-hidden="true" size={22} />}</button>
    </div> : <div className="chat-call-controls">
      <button className={state.muted ? "active" : ""} onClick={onToggleMute} title={state.muted ? phrase("打开麦克风", "Turn on microphone") : phrase("静音", "Mute")} type="button">{state.muted ? <MicOff aria-hidden="true" size={20} /> : <Mic aria-hidden="true" size={20} />}</button>
      {state.call.type === "video" ? <>
        <button className={!state.cameraEnabled ? "active" : ""} onClick={onToggleCamera} title={state.cameraEnabled ? phrase("关闭摄像头", "Turn off camera") : phrase("打开摄像头", "Turn on camera")} type="button">{state.cameraEnabled ? <Camera aria-hidden="true" size={20} /> : <CameraOff aria-hidden="true" size={20} />}</button>
        <button onClick={onSwitchCamera} title={phrase("切换摄像头", "Switch camera")} type="button"><RefreshCw aria-hidden="true" size={20} /></button>
      </> : null}
      <button onClick={() => onMinimize(true)} title={phrase("最小化通话", "Minimize call")} type="button"><Minimize2 aria-hidden="true" size={20} /></button>
      <button className="hangup" disabled={state.phase === "ending"} onClick={onEnd} title={phrase("挂断", "End call")} type="button"><PhoneOff aria-hidden="true" size={21} /></button>
    </div>}
  </section>;
}

function phaseText(phase: CallPhase, locale: "zh-CN" | "en-US"): string {
  const text = (chinese: string, english: string) => locale === "en-US" ? english : chinese;
  if (phase === "incoming") return text("邀请你通话", "Incoming call");
  if (phase === "outgoing") return text("正在呼叫", "Calling");
  if (phase === "connecting") return text("正在连接", "Connecting");
  if (phase === "ending") return text("正在结束", "Ending");
  return text("通话中", "In call");
}

function callEndNotice(call: CallSession, locale: "zh-CN" | "en-US"): string {
  const text = (chinese: string, english: string) => locale === "en-US" ? english : chinese;
  if (call.status === "declined") return text("对方已拒绝通话。", "The call was declined.");
  if (call.status === "busy") return text("对方正在通话中。", "The other person is already in a call.");
  if (call.status === "cancelled") return text("通话已取消。", "The call was cancelled.");
  if (call.status === "missed") return text("通话无人接听。", "The call was not answered.");
  if (call.status === "failed") return text("通话连接已中断。", "The call connection was interrupted.");
  return text("通话已结束。", "The call ended.");
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
