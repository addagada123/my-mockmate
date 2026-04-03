# Mockmate VR — Unity Setup Guide

Step-by-step instructions to set up your Unity project so that pressing **"Take Test in VR"** on the web app automatically starts the VR interview in Unity.

---

## Prerequisites

- Unity **2022.3 LTS** or newer (2023.x / 6000.x also work)
- A VR headset (Quest, PCVR via Link, etc.) with XR Plugin Management configured
- Your Mockmate backend running (locally or on Railway)

---

## Step 1 — Import the Scripts

Copy these scripts from the repo `unity/` folder into your Unity project's `Assets/Scripts/Mockmate/` folder:

| File | Purpose |
|------|---------|
| `MockmateVRApiClient.cs` | Makes HTTP calls to the Mockmate backend |
| `MockmateVRFlowController.cs` | Manages the interview lifecycle (question → speak → listen → submit) |
| `MockmateVRWebGLBootstrap.cs` | Receives the bridge token from the browser page and starts the WebGL flow |
| `MockmateVRAnimationBridge.cs` | **NEW** — Handles mouth, jaw, and typing animations |
| `MockmateVRBackendTTS.cs` | Proxies TTS through the Mockmate backend for WebGL |
| `MockmateVRBrowserTTS.cs` | Browser-native speech fallback for WebGL |
| `MockmateVRBrowserSTT.cs` | Browser-native speech recognition input for WebGL |
| `VRInterviewGlue.cs` | Auto-wires the flow controller to TTS, STT, and animation systems |
| `MockmateVRUIBinder.cs` | Optional helper that binds flow events to TextMeshPro/UI panels |

> Note
> `MockmateVRDeepLinkBootstrap.cs` and `MockmateVRTokenPoller.cs` are referenced by older docs but are not present in this repo. The current browser WebGL path uses `MockmateVRWebGLBootstrap.cs` instead.

---

## Step 2 — Set Up the Scene Hierarchy

Create these GameObjects in your scene:

1. **Create** → **Empty Object** → name it **`MockmateVRManager`**
2. Add these components to `MockmateVRManager`:
   - `MockmateVRApiClient`
   - `MockmateVRFlowController`
   - `MockmateVRAnimationBridge`
   - `MockmateVRBackendTTS`
   - `MockmateVRBrowserTTS`
   - `MockmateVRBrowserSTT`
   - `VRInterviewGlue`
3. **Create** → **Empty Object** → name it exactly **`MockmateVRBootstrap`**
4. Add `MockmateVRWebGLBootstrap` to `MockmateVRBootstrap`
5. Optional: add `MockmateVRUIBinder` to your VR canvas/UI object

For browser WebGL, the object name `MockmateVRBootstrap` is required because the page calls:

```csharp
unityInstance.SendMessage("MockmateVRBootstrap", "SetBridgeToken", payload)
```

---

## Step 3 — Configure the Inspector

### MockmateVRApiClient
| Field | Value |
|-------|-------|
| Api Base | `https://mockmate-api-6dvm.onrender.com` (or your local URL) |
| Bridge Token | *Leave empty* — this gets auto-filled |

### MockmateVRFlowController
| Field | Value |
|-------|-------|
| Api Client | Drag the `MockmateVRManager` GameObject here |
| Auto Start When Token Present | ✅ Checked |
| Simulated Speak Chars Per Second | `18` |
| Prep Time Seconds | `10` |
| Silence Gap Seconds | `3` |

### MockmateVRWebGLBootstrap
| Field | Value |
|-------|-------|
| Flow Controller | Drag the `MockmateVRManager` GameObject here |

### MockmateVRBackendTTS (Optional for Audio)
| Field | Value |
|-------|-------|
| Api Client | Drag the `MockmateVRManager` GameObject here |
| Audio Source | Drag an `AudioSource` in the scene here |
| Voice | `alloy` (or your preferred OpenAI TTS voice) |

### VRInterviewGlue
| Field | Value |
|-------|-------|
| Backend TTS | Drag the `MockmateVRManager` GameObject here |
| Flow Controller | Drag the `MockmateVRManager` GameObject here |
| Browser TTS | Drag the `MockmateVRBrowserTTS` object / component here |
| Browser STT | Drag the `MockmateVRBrowserSTT` object / component here |
| Audio Recorder | Leave empty for browser WebGL |
| STT Client | Drag the `STTClient` object / component here |

### MockmateVRAnimationBridge
| Field | Value |
|-------|-------|
| Animator | Your interviewer avatar Animator |
| Jaw Bone | Optional jaw transform |
| Face Renderer | Optional skinned mesh renderer with mouth blend shapes |
| Lip Sync Audio Source | Same `AudioSource` used by `MockmateVRBackendTTS` |

---

## Step 4 — Wire Up Your VR UI (Events)

Connect the `MockmateVRFlowController` events to your VR UI elements:

| Event | What to do |
|-------|-----------|
| `OnQuestionReceived(string)` | Display the question text on a VR panel |
| `OnPrepTick(float)` | Show countdown timer |
| `OnAnswerNow` | Show "Speak now!" prompt |
| `OnStatusMessage(string)` | Display status text in VR UI |
| `OnError(string)` | Display error message |
| `OnRunningScoreUpdated(float)` | Update score display |
| `OnCompleted(float)` | Show final score & end screen |

If you use `VRInterviewGlue`, it already auto-subscribes at runtime to:
- `OnQuestionReceived`
- `OnQuestionSpeakingStart`
- `OnListeningStart`
- `OnListeningEnd`

That means you should not manually duplicate speech/listening behavior hooks in the Inspector unless you intentionally want multiple listeners.

For browser WebGL:
- Keep `MockmateVRBrowserSTT` enabled
- Keep `WebGLWhisperSTT`, `AudioRecorder`, and `OpenAIWhisperSTT` disabled unless you are testing an editor/native fallback path
- Leave `MockmateVRBrowserSTT -> On Transcript Chunk` empty; `VRInterviewGlue` subscribes to it at runtime

### Feeding STT Results Back

During listening, your speech-to-text system should call:

```csharp
// In your STT callback:
flowController.AppendTranscriptChunk(recognizedText);
```

This feeds real-time transcription into the flow controller. After silence is detected (3 seconds by default), it automatically submits the answer.

---

## Step 5 — Browser WebGL Bootstrap

For the browser WebGL flow used by this repo, Unity does not poll for a device token.

Instead:
1. The React app loads `/vr/index.html?bridge_token=...&api_base=...`
2. The page boots Unity
3. The page sends that payload to `MockmateVRBootstrap.SetBridgeToken(...)`
4. `MockmateVRWebGLBootstrap` calls `flowController.BeginFlow()`

If browser VR loads but never starts the interview, first verify that:
- the scene contains a GameObject named exactly `MockmateVRBootstrap`
- it has `MockmateVRWebGLBootstrap`
- its `flowController` field points to the real `MockmateVRFlowController`

---

## Step 6 — Build Settings

### For Quest (Android)
1. **File** → **Build Settings** → Switch to **Android**
2. **XR Plugin Management** → Enable **Oculus** or **OpenXR**
3. **Player Settings** → **Other Settings** → Minimum API Level: **29+**
4. Build and Run

### For PC VR (SteamVR / Oculus Link)
1. **File** → **Build Settings** → Switch to **Windows**
2. **XR Plugin Management** → Enable **OpenXR** or **Oculus**
3. Build and Run

---

## Step 7 — Test the Full Flow

1. Open your Unity project and press **Play** (or deploy to headset)
2. Open the browser WebGL build through the web app
3. On the web app, select a topic → choose difficulty → click **"Take Test in VR"**
4. The page injects the bridge token into `MockmateVRBootstrap`
5. Unity starts the interview
6. The interviewer speaks the question
7. You answer via your microphone (connected to STT → `AppendTranscriptChunk`)
8. After all questions, scores appear on both Unity and the web dashboard

---

## Step 8 — Enable Desktop VR App Launch (Optional)

To make the **"Desktop App"** button automatically open your Unity build:

1. Locate the `scripts/register_vr_protocol.ps1` script in the root of the project.
2. Open PowerShell as **Administrator**.
3. Run the script, passing the path to your compiled Unity `.exe`:
   ```powershell
   .\scripts\register_vr_protocol.ps1 -ExePath "C:\Path\To\Your\MockmateVR.exe"
   ```
4. Now, when you choose **"Desktop App"** in the web app, your browser will launch the protocol.

> [!TIP]
> Use **"Browser VR"** if you don't want to install anything or if you are on a device that doesn't support the standalone app.

---

## How the Browser WebGL Token Sync Works

```
Web App clicks "Take Test in VR"
         │
         ├─── POST /vr-test/start → gets bridge_token
         │
         └─── Loads /vr/index.html?bridge_token=...&api_base=...
                    │
                    ├─── Unity WebGL runtime loads
                    └─── SendMessage("MockmateVRBootstrap", "SetBridgeToken", payload)
                              │
                              └─── MockmateVRWebGLBootstrap starts MockmateVRFlowController
```

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Unity doesn't pick up the token | Make sure the scene contains a GameObject named exactly `MockmateVRBootstrap` and that it has `MockmateVRWebGLBootstrap` attached. |
| "Bridge token expired" error | Tokens expire after 6 hours. Click "Take Test in VR" again to get a fresh token. |
| Network errors in Unity | Check that `Api Base` URL is correct and accessible from your headset/PC. |
| Questions don't load | Ensure you've generated questions on the web app first (select a topic and difficulty). |
| STT not working | Make sure your STT system calls `AppendTranscriptChunk()` during listening. |
| Protocol not opening | Re-run Step 8 and ensure the path to your `.exe` is correct. |
