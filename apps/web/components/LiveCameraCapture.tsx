"use client";

import { useEffect, useRef, useState } from "react";
import { ChartLineUp, Image as ImageIcon } from "@phosphor-icons/react";
import { CATEGORY_PROOF_HINT, inferHabitCategory } from "@/lib/habitCategory";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { useToast } from "./Toast";

const PRESS_FEEDBACK = "transition-transform duration-150 ease-emil-out active:scale-[0.97]";

interface Props {
  onClose: () => void;
  contractIndex: number;
  habitName: string;
  onVerified: () => void;
}

interface ChallengeState {
  challenge: string;
  token: string;
}

type CameraError = "denied" | "no-device" | "other" | null;

const MAX_PROOF_FILE_BYTES = 8 * 1024 * 1024; // 8MB — only relevant to the upload path; a live capture is always a modest single JPEG frame
const CAPTURE_COUNTDOWN_SECONDS = 3; // gives enough time to get into the gesture after tapping Capture — doing both at once (tap + pose) was the actual complaint

/// A real tertiary button, not a hidden underlined text link — these two alternate proof paths
/// (gallery upload, app-summary screenshot) are equally valid submission methods, not fallbacks
/// to apologize for, so they get the same bg-surface pill treatment as any other secondary
/// action, with the hint copy shown as visible detail instead of buried in a trailing dash.
function ProofOptionButton({
  icon,
  label,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left ${PRESS_FEEDBACK}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
    </button>
  );
}

/// Camera-first proof submission — live capture is the default and only path that skips the
/// upload disclaimer, but a plain file upload is always available too (see the "Or upload a
/// photo instead" link below): it goes through the exact same checks either way (duplicate-hash
/// backstop + the random-challenge requirement in /api/verify), so it's not a weaker path,
/// just a slower one in practice — an uploaded photo has to have already been taken *after* the
/// challenge was issued, which is easy to get wrong, whereas the in-page camera guarantees it.
/// `usedUpload` is purely an audit flag (`habit_completions.via_gallery_fallback`), not a
/// security gate.
///
/// No `open` prop — the caller conditionally mounts this (e.g. `{capturing && <LiveCameraCapture
/// .../>}`) rather than passing a boolean, so every open is a fresh mount with clean state,
/// instead of needing a reset-on-close effect branch (which is exactly the kind of
/// setState-in-effect the react-hooks/set-state-in-effect rule flags — see CLAUDE.md's gotcha
/// and the same fix applied to EditHabitModal.tsx earlier this session).
export function LiveCameraCapture({ onClose, contractIndex, habitName, onVerified }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appSummaryInputRef = useRef<HTMLInputElement>(null);

  const category = inferHabitCategory(habitName);
  const toast = useToast();

  const [challengeState, setChallengeState] = useState<ChallengeState | null>(null);
  const [cameraError, setCameraError] = useState<CameraError>(null);
  const [live, setLive] = useState(false);
  const [multipleCameras, setMultipleCameras] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [usedUpload, setUsedUpload] = useState(false);
  // "camera" covers both live capture and the plain "upload a photo instead" fallback (still a
  // photo of the user, just not captured live) — "appSummary" is the explicit second path for a
  // screenshot of an app-generated summary, which skips the gesture-challenge requirement
  // server-side (see app/api/verify/route.ts). Only ever set by the two distinct pickers below,
  // never inferred from the file itself.
  const [proofType, setProofType] = useState<"camera" | "appSummary">("camera");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
  }

  // Fetches a fresh challenge + enumerates devices once, on mount; stops the stream on unmount
  // (component only exists while the caller wants it open — see the no-`open`-prop note above).
  useEffect(() => {
    let cancelled = false;

    fetch(`/api/verify/challenge?contractIndex=${contractIndex}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Could not start verification"))))
      .then((data) => {
        if (!cancelled) setChallengeState({ challenge: data.challenge, token: data.token });
      })
      .catch(() => {
        if (!cancelled) setCameraError("other");
      });

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (!cancelled) setMultipleCameras(devices.filter((d) => d.kind === "videoinput").length > 1);
      })
      .catch(() => {
        // Device labels/count may be limited before permission is granted on some browsers —
        // harmless, the flip button just won't show.
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [contractIndex]);

  // Opens the camera stream once a challenge is ready — separate from the effect above so
  // flipping facingMode (or retaking a shot) doesn't re-fetch a new challenge each time.
  useEffect(() => {
    if (!challengeState || capturedDataUrl) return;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraError(null);
        setLive(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotFoundError" || name === "DevicesNotFoundError") setCameraError("no-device");
        else if (name === "NotAllowedError" || name === "PermissionDeniedError") setCameraError("denied");
        else setCameraError("other");
      });

    return () => {
      cancelled = true;
    };
  }, [challengeState, facingMode, capturedDataUrl]);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setCapturedDataUrl(canvas.toDataURL("image/jpeg", 0.9));
    stopStream();
  }

  function clearCountdownTimer() {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }

  // Tapping Capture and holding the gesture at the same instant is the actual problem being
  // solved here — a short countdown separates "start" from "the moment it's taken," same as any
  // camera app's self-timer, so the gesture just needs to be held once the count reaches zero.
  function startCapture() {
    setCountdown(CAPTURE_COUNTDOWN_SECONDS);
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearCountdownTimer();
          capture();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function cancelCountdown() {
    clearCountdownTimer();
    setCountdown(null);
  }

  // Stop the countdown if the modal closes/unmounts mid-count — otherwise a queued interval
  // could fire capture() (and setState) after the video element is gone.
  useEffect(() => clearCountdownTimer, []);

  function retake() {
    setCapturedDataUrl(null);
    setUsedUpload(false);
    setProofType("camera");
    setSubmitError(null);
    setResultMessage(null);
  }

  function handleUploadedFile(file: File) {
    if (file.size > MAX_PROOF_FILE_BYTES) {
      setSubmitError("That image is too large — try one under 8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUsedUpload(true);
      setProofType("camera");
      setCapturedDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  function handleAppSummaryFile(file: File) {
    if (file.size > MAX_PROOF_FILE_BYTES) {
      setSubmitError("That image is too large — try one under 8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUsedUpload(true);
      setProofType("appSummary");
      setCapturedDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!capturedDataUrl || !challengeState) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const base64 = capturedDataUrl.split(",")[1] ?? "";
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractIndex,
          imageBase64: base64,
          mimeType: "image/jpeg",
          challengeToken: challengeState.token,
          viaGalleryFallback: usedUpload,
          proofType,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Verification request failed");
      setResultMessage(
        `${data.verified ? "✓" : "✗"} ${data.reason} (${Math.round(data.confidence * 100)}% confidence)`,
      );
      if (data.verified) {
        toast(`"${habitName}" verified`);
        onVerified();
      } else {
        toast(`"${habitName}" proof was rejected`, "error");
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  const showUploadLink = !capturedDataUrl && challengeState && cameraError !== "no-device";

  return (
    <Modal open title="Verify habit" onClose={onClose}>
      <div className="space-y-3">
        {challengeState && !capturedDataUrl && (
          <p className="rounded-md bg-surface p-3 text-center text-sm">
            {cameraError === null ? "While filming: " : "Show us: "}
            <span className="font-medium">{challengeState.challenge}</span>
          </p>
        )}

        {!challengeState && !cameraError && <p className="text-center text-sm text-muted">Preparing verification…</p>}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUploadedFile(e.target.files[0])}
        />
        <input
          ref={appSummaryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleAppSummaryFile(e.target.files[0])}
        />

        {cameraError === "denied" && (
          <div className="space-y-2 text-center">
            <p className="text-sm text-muted">
              Camera access was denied. Allow camera access in your browser settings and try again, or upload a
              fresh photo showing the check above instead.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setCameraError(null)} className={`rounded-md bg-surface px-3 py-2 text-sm ${PRESS_FEEDBACK}`}>
                Try again
              </button>
              <button onClick={() => fileInputRef.current?.click()} className={`rounded-md bg-surface px-3 py-2 text-sm ${PRESS_FEEDBACK}`}>
                Upload instead
              </button>
            </div>
          </div>
        )}

        {cameraError === "no-device" && (
          <div className="space-y-2 text-center">
            <p className="text-sm text-muted">No camera detected on this device — upload a fresh photo instead.</p>
            <button onClick={() => fileInputRef.current?.click()} className={`rounded-md bg-surface px-3 py-2 text-sm ${PRESS_FEEDBACK}`}>
              Choose photo
            </button>
          </div>
        )}

        {cameraError === "other" && (
          <div className="space-y-2 text-center">
            <p className="text-sm text-muted">Couldn&apos;t start the camera — try again, or upload a photo instead.</p>
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setCameraError(null)} className={`rounded-md bg-surface px-3 py-2 text-sm ${PRESS_FEEDBACK}`}>
                Try again
              </button>
              <button onClick={() => fileInputRef.current?.click()} className={`rounded-md bg-surface px-3 py-2 text-sm ${PRESS_FEEDBACK}`}>
                Upload instead
              </button>
            </div>
          </div>
        )}

        {!capturedDataUrl && cameraError === null && (
          <div className="relative overflow-hidden rounded-md bg-surface">
            <video ref={videoRef} autoPlay playsInline muted className="aspect-[3/4] w-full object-cover" />
            {countdown !== null && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <span className="text-6xl font-medium text-white">{countdown}</span>
              </div>
            )}
          </div>
        )}

        {capturedDataUrl && (
          <div className="relative overflow-hidden rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capturedDataUrl} alt="Captured proof" className="aspect-[3/4] w-full rounded-md object-cover" />
            {/* Scanning sweep while the AI verifies — communicates "actively being analyzed"
                instead of leaving the still image sitting there with only the button label
                changing to "Verifying…". */}
            {submitting && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
                <div className="animate-scan-line absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-white/25 to-transparent" />
              </div>
            )}
          </div>
        )}

        {!capturedDataUrl && live && cameraError === null && (
          <div className="flex items-center justify-center gap-2">
            {countdown !== null ? (
              <button onClick={cancelCountdown} className={`rounded-full bg-surface px-6 py-3 text-sm ${PRESS_FEEDBACK}`}>
                Cancel
              </button>
            ) : (
              <button onClick={startCapture} className={`rounded-full bg-foreground px-6 py-3 text-sm text-background ${PRESS_FEEDBACK}`}>
                Capture
              </button>
            )}
            {multipleCameras && countdown === null && (
              <button
                onClick={() => setFacingMode((m) => (m === "environment" ? "user" : "environment"))}
                className={`rounded-full bg-surface px-4 py-3 text-sm ${PRESS_FEEDBACK}`}
              >
                Flip
              </button>
            )}
          </div>
        )}

        {showUploadLink && (
          <div className="space-y-2">
            <ProofOptionButton
              icon={<ImageIcon size={18} weight="bold" />}
              label="Upload a photo instead"
              detail="Using the camera gets approved faster."
              onClick={() => fileInputRef.current?.click()}
            />
            <ProofOptionButton
              icon={<ChartLineUp size={18} weight="bold" />}
              label="Submit an app summary instead"
              detail={CATEGORY_PROOF_HINT[category]}
              onClick={() => appSummaryInputRef.current?.click()}
            />
          </div>
        )}

        {capturedDataUrl && !resultMessage && proofType === "appSummary" && (
          <p className="text-center text-xs text-muted">Submitting as an app summary — no gesture check needed.</p>
        )}

        {capturedDataUrl && !resultMessage && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={retake}
              disabled={submitting}
              className={`rounded-full bg-surface px-4 py-3 text-sm ${PRESS_FEEDBACK} disabled:opacity-50`}
            >
              Retake
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className={`flex items-center gap-1.5 rounded-full bg-foreground px-6 py-3 text-sm text-background ${PRESS_FEEDBACK} disabled:opacity-50`}
            >
              {submitting && <Spinner size={14} />}
              {submitting ? "Verifying…" : "Submit"}
            </button>
          </div>
        )}

        {resultMessage && (
          <div className="space-y-2 text-center">
            <p className="text-sm">{resultMessage}</p>
            <div className="flex items-center justify-center gap-2">
              {!resultMessage.startsWith("✓") && (
                <button onClick={retake} className={`rounded-full bg-surface px-4 py-3 text-sm ${PRESS_FEEDBACK}`}>
                  Try again
                </button>
              )}
              <button onClick={onClose} className={`rounded-full bg-foreground px-4 py-3 text-sm text-background ${PRESS_FEEDBACK}`}>
                Close
              </button>
            </div>
          </div>
        )}

        {submitError && <p className="text-center text-xs text-red-500">{submitError}</p>}
      </div>
    </Modal>
  );
}
