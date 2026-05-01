import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useCameraProctoring({
  active,
  warningCallback,
  snapshotIntervalMs = 45000,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const snapshotCanvasRef = useRef(null);
  const monitorTimerRef = useRef(null);
  const snapshotTimerRef = useRef(null);
  const activeSinceRef = useRef(null);
  const inactiveSinceRef = useRef(null);
  const statsRef = useRef({
    permissionPrompted: false,
    permissionGranted: false,
    permissionDenied: false,
    cameraOffEvents: 0,
    cameraRecoveredEvents: 0,
    snapshotsTaken: 0,
    activeMs: 0,
    inactiveMs: 0,
    strictModeEnabled: false,
  });

  const [permissionState, setPermissionState] = useState("idle");
  const [cameraOn, setCameraOn] = useState(false);
  const [strictMode, setStrictMode] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [lastError, setLastError] = useState("");

  const flushTimers = useCallback(() => {
    if (monitorTimerRef.current) {
      clearInterval(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }
    if (snapshotTimerRef.current) {
      clearInterval(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
  }, []);

  const noteActiveWindow = useCallback((isActive) => {
    const now = Date.now();
    if (isActive) {
      if (inactiveSinceRef.current) {
        statsRef.current.inactiveMs += now - inactiveSinceRef.current;
        inactiveSinceRef.current = null;
      }
      if (!activeSinceRef.current) activeSinceRef.current = now;
    } else {
      if (activeSinceRef.current) {
        statsRef.current.activeMs += now - activeSinceRef.current;
        activeSinceRef.current = null;
      }
      if (!inactiveSinceRef.current) inactiveSinceRef.current = now;
    }
  }, []);

  const stopCamera = useCallback(() => {
    flushTimers();
    noteActiveWindow(false);
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  }, [flushTimers, noteActiveWindow]);

  const captureSnapshot = useCallback(() => {
    if (!videoRef.current || !cameraOn) return null;
    const video = videoRef.current;
    const canvas = snapshotCanvasRef.current || document.createElement("canvas");
    snapshotCanvasRef.current = canvas;
    const width = video.videoWidth || 320;
    const height = video.videoHeight || 240;
    if (!width || !height) return null;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
    statsRef.current.snapshotsTaken += 1;
    setSnapshots((prev) => [{ id: `${Date.now()}`, dataUrl }, ...prev].slice(0, 4));
    return dataUrl;
  }, [cameraOn]);

  const startMonitoring = useCallback(() => {
    flushTimers();
    monitorTimerRef.current = setInterval(() => {
      const stream = streamRef.current;
      const track = stream?.getVideoTracks?.()[0];
      const isLive = !!track && track.readyState === "live" && !track.muted && track.enabled;
      setCameraOn((prev) => {
        if (prev !== isLive) {
          if (isLive) {
            statsRef.current.cameraRecoveredEvents += 1;
            noteActiveWindow(true);
          } else {
            statsRef.current.cameraOffEvents += 1;
            noteActiveWindow(false);
            warningCallback?.("Camera feed stopped. Please re-enable your camera to continue the proctored test.");
          }
        }
        return isLive;
      });
    }, 2500);
  }, [flushTimers, noteActiveWindow, warningCallback]);

  useEffect(() => {
    statsRef.current.strictModeEnabled = strictMode;
    if (!strictMode || !active || !cameraOn) {
      if (snapshotTimerRef.current) {
        clearInterval(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
      return undefined;
    }
    snapshotTimerRef.current = setInterval(() => {
      captureSnapshot();
    }, snapshotIntervalMs);
    return () => {
      if (snapshotTimerRef.current) {
        clearInterval(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
    };
  }, [active, cameraOn, captureSnapshot, snapshotIntervalMs, strictMode]);

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState("unsupported");
      setLastError("Camera access is not supported in this browser.");
      warningCallback?.("Camera is not supported in this browser. Test will continue in fallback mode.");
      return false;
    }

    statsRef.current.permissionPrompted = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });
      stopCamera();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          return false;
        }
      }
      statsRef.current.permissionGranted = true;
      statsRef.current.permissionDenied = false;
      setPermissionState("granted");
      setLastError("");
      setCameraOn(true);
      noteActiveWindow(true);
      startMonitoring();
      return true;
    } catch (error) {
      statsRef.current.permissionDenied = true;
      setPermissionState("denied");
      setLastError(error?.message || "Camera permission denied.");
      noteActiveWindow(false);
      warningCallback?.("Camera permission was denied. You can continue, but proctoring will be marked as degraded.");
      return false;
    }
  }, [noteActiveWindow, startMonitoring, stopCamera, warningCallback]);

  useEffect(() => {
    if (!active) {
      stopCamera();
      return undefined;
    }
    return () => {
      stopCamera();
    };
  }, [active, stopCamera]);

  const getSubmissionData = useCallback(() => {
    const now = Date.now();
    const stats = { ...statsRef.current };
    if (activeSinceRef.current) {
      stats.activeMs += now - activeSinceRef.current;
    }
    if (inactiveSinceRef.current) {
      stats.inactiveMs += now - inactiveSinceRef.current;
    }
    const totalObservedMs = stats.activeMs + stats.inactiveMs;
    const cameraUptimePct = totalObservedMs > 0 ? (stats.activeMs / totalObservedMs) * 100 : (cameraOn ? 100 : 0);
    return {
      permission_state: permissionState,
      permission_prompted: stats.permissionPrompted,
      permission_granted: stats.permissionGranted,
      permission_denied: stats.permissionDenied,
      camera_on: cameraOn,
      camera_off_events: stats.cameraOffEvents,
      camera_recovered_events: stats.cameraRecoveredEvents,
      strict_mode: stats.strictModeEnabled,
      snapshot_count: stats.snapshotsTaken,
      active_ms: Math.round(stats.activeMs),
      inactive_ms: Math.round(stats.inactiveMs),
      camera_uptime_pct: Math.round(cameraUptimePct * 100) / 100,
    };
  }, [cameraOn, permissionState]);

  const submissionData = useMemo(() => getSubmissionData(), [getSubmissionData]);

  return {
    videoRef,
    permissionState,
    cameraOn,
    strictMode,
    setStrictMode,
    snapshots,
    lastError,
    requestCamera,
    stopCamera,
    captureSnapshot,
    getSubmissionData,
    submissionData,
  };
}
