# Mockmate VR — Unity Setup Guide

Step-by-step instructions to set up your Unity project so that pressing **"Take Test in VR"** on the web app automatically starts the VR interview in Unity.

---

## Prerequisites

- Unity **2022.3 LTS** or newer (2023.x / 6000.x also work)
- A VR headset (Quest, PCVR via Link, etc.) with XR Plugin Management configured
- Your Mockmate backend running (locally or on Railway)

---

## Step 1 — Import the Scripts

Copy these **4 C# files** from the `unity/` folder into your Unity project's `Assets/Scripts/Mockmate/` folder:

| File | Purpose |
|------|---------|
| `MockmateVRApiClient.cs` | Makes HTTP calls to the Mockmate backend |
| `MockmateVRFlowController.cs` | Manages the interview lifecycle (question → speak → listen → submit) |
| `MockmateVRDeepLinkBootstrap.cs` | Handles deep link launches (backup method) |
| `MockmateVRTokenPoller.cs` | Polls for bridge tokens automatically |
| `MockmateVRAnimationBridge.cs` | **NEW** — Handles mouth, jaw, and typing animations |

---

## Step 2 — Set Up the Scene Hierarchy

Create a single GameObject in your scene with all the scripts attached:

1. **Create** → **Empty Object** → name it **`MockmateVRManager`**
2. **Add Component** → `MockmateVRApiClient`
3. **Add Component** → `MockmateVRFlowController`
4. **Add Component** → `MockmateVRTokenPoller`
5. **Add Component** → `MockmateVRDeepLinkBootstrap`
6. **Add Component** → `MockmateVRAnimationBridge`

Your Inspector for `MockmateVRManager` should show all 4 scripts.

---

## Step 3 — Configure the Inspector

### MockmateVRApiClient
| Field | Value |
|-------|-------|
| Api Base | `https://mockmate-api-production.up.railway.app` (or your local URL) |
| Bridge Token | *Leave empty* — this gets auto-filled |

### MockmateVRFlowController
| Field | Value |
|-------|-------|
| Api Client | Drag the `MockmateVRManager` GameObject here |
| Auto Start When Token Present | ✅ Checked |
| Simulated Speak Chars Per Second | `18` |
| Prep Time Seconds | `10` |
| Silence Gap Seconds | `3` |

### MockmateVRTokenPoller ⭐ (Key Script)
| Field | Value |
|-------|-------|
| Flow Controller | Drag the `MockmateVRManager` GameObject here |
| Api Client | Drag the `MockmateVRManager` GameObject here |
| Poll Interval Seconds | `2.5` |
| Device Id | *Leave empty* (auto-uses `SystemInfo.deviceUniqueIdentifier`) **OR** paste your **session ID** from the web app |
| Api Base | `https://mockmate-api-production.up.railway.app` |
| Poll Local File | ✅ Checked |
| Local Folder Name | `MockmateVR` |
| Local File Name | `bridge_token.json` |

### MockmateVRDeepLinkBootstrap
| Field | Value |
|-------|-------|
| Flow Controller | Drag the `MockmateVRManager` GameObject here |
| Default Api Base | `https://mockmate-api-production.up.railway.app` |
| Auto Begin On Deep Link | ✅ Checked |

---

## Step 4 — Wire Up Your VR UI (Events)

Connect the `MockmateVRFlowController` events to your VR UI elements:

| Event | What to do |
|-------|-----------|
| `OnQuestionReceived(string)` | Display the question text on a VR panel / TTS |
| `OnQuestionSpeakingStart` | Drag `MockmateVRAnimationBridge.StartTalking` here |
| `OnQuestionSpeakingEnd` | Drag `MockmateVRAnimationBridge.StopTalking` here |
| `OnListeningStart` | Drag `MockmateVRAnimationBridge.StartTyping` here |
| `OnListeningEnd` | Drag `MockmateVRAnimationBridge.StopTyping` here |
| `OnPrepTick(float)` | Show countdown timer |
| `OnAnswerNow` | Show "Speak now!" prompt |
| `OnListeningStart` | Start STT / microphone recording |
| `OnListeningEnd` | Stop STT / microphone recording |
| `OnStatusMessage(string)` | Display status text in VR UI |
| `OnError(string)` | Display error message |
| `OnRunningScoreUpdated(float)` | Update score display |
| `OnCompleted(float)` | Show final score & end screen |

### Feeding STT Results Back

During listening, your speech-to-text system should call:

```csharp
// In your STT callback:
flowController.AppendTranscriptChunk(recognizedText);
```

This feeds real-time transcription into the flow controller. After silence is detected (3 seconds by default), it automatically submits the answer.

---

## Step 5 — Set Device ID (Important!)

The **Device ID** is how Unity knows which bridge token to pick up. You have two options:

### Option A: Auto-generated (Default)
Leave the `Device Id` field empty. Unity will use `SystemInfo.deviceUniqueIdentifier`. 

> ⚠️ With this option, you need to tell the web app your device's unique ID. You can find it by adding a `Debug.Log(SystemInfo.deviceUniqueIdentifier)` to your scene.

### Option B: Use Session ID (Recommended for Development)
Set the `Device Id` to match the **session ID** shown on the VR Test Control panel in the web app. The web app automatically registers the token with this ID.

### Option C: Custom ID
Set a custom string like `"my-quest-3"` and configure the web app to use the same ID.

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
2. Unity shows: *"Waiting for bridge token from web app..."*
3. On the web app, select a topic → choose difficulty → click **"Take Test in VR"**
4. Unity automatically picks up the token and starts the interview
5. The interviewer "speaks" the question (or you wire it to TTS)
6. You answer via your microphone (connected to STT → `AppendTranscriptChunk`)
7. After all questions, scores appear on both Unity and the web dashboard

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

## How the Automatic Token Sync Works

```
Web App clicks "Take Test in VR"
         │
         ├─── POST /vr-test/start → gets bridge_token
         │
         ├─── POST /vr-bridge/register-token → stores token for polling
         │
         ├─── Deep link attempt (URL: mockmate://start-vr?...)
         │     └─── Launches your .exe (if Step 8 is done)
         │
         └─── Downloads bridge_token.json (backup for manual copy)

Unity (running in Play mode / on headset)
         │
         ├─── Polls GET /vr-bridge/token-poll every 2.5 seconds
         │     └─── When token found → auto-starts interview
         │
         └─── Also checks %APPDATA%/MockmateVR/bridge_token.json (if polling fails)
```

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Unity doesn't pick up the token | Make sure `Device Id` in Unity matches what the web app sends (default: `mockmate-vr-default`). Check the console for `[MockmateVR-Poller]` logs. |
| "Bridge token expired" error | Tokens expire after 6 hours. Click "Take Test in VR" again to get a fresh token. |
| Network errors in Unity | Check that `Api Base` URL is correct and accessible from your headset/PC. |
| Questions don't load | Ensure you've generated questions on the web app first (select a topic and difficulty). |
| STT not working | Make sure your STT system calls `AppendTranscriptChunk()` during listening. |
| Protocol not opening | Re-run Step 8 and ensure the path to your `.exe` is correct. |
