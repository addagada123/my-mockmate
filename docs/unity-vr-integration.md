# Unity VR Integration (Complete Flow)

This project now supports a full VR interview flow that reuses already generated normal-test questions.

## 1) Web flow you already have

1. Upload resume and generate questions.
2. Go to topic test and choose difficulty.
3. Click `Take Test in VR`.
4. The app creates a VR bridge token and shows it in the VR control screen.

## 2) Backend endpoints for Unity

Unity should use the `bridge_token` (no JWT needed in Unity).

- `GET /vr-bridge/next?bridge_token=...`
- `POST /vr-bridge/answer?bridge_token=...`
- `POST /vr-bridge/complete?bridge_token=...`

Bridge token is temporary (currently 6 hours).

## 3) Drop-in Unity scripts

Use these files from this repo:

- `unity/MockmateVRApiClient.cs`
- `unity/MockmateVRFlowController.cs`

### Scene setup

1. Create an empty GameObject: `MockmateVRManager`.
2. Add `MockmateVRApiClient` component.
3. Set:
   - `Api Base`: your backend URL (e.g. `http://127.0.0.1:8000` or deployed URL)
   - `Bridge Token`: copy from web VR control screen
4. Add `MockmateVRFlowController` component.
5. Assign `Api Client` reference.
6. Wire UnityEvents:
   - `OnQuestionReceived(string)`: show question text UI + feed to TTS text
   - `OnQuestionSpeakingStart`: trigger avatar speaking animation + start TTS
   - `OnQuestionSpeakingEnd`: stop speaking animation
   - `OnListeningStart`: start microphone capture
   - `OnListeningEnd`: stop microphone capture
   - `OnError(string)`: error UI/log
   - `OnRunningScoreUpdated(float)`: progress UI
   - `OnCompleted(float)`: completion/result UI

## 4) Runtime lifecycle in Unity

1. Call `BeginFlow()`
2. `OnQuestionReceived` fires with question text
3. Start TTS + avatar speak
4. After TTS ends call `NotifyQuestionSpeechCompleted()`
5. Record user audio, run STT
6. Call `SubmitCurrentAnswer(transcript)`
7. Script auto-fetches next question until finished
8. Completion auto-posted to backend via `/vr-bridge/complete`

## 5) Performance tab

When VR completes, results are stored in user session and test attempts with mode `vr`. They appear in performance analytics with other attempts.

## 6) If you share Unity project

If you attach your Unity project, I will wire:

- concrete TTS call points in your existing avatar system,
- mic/STT provider hookup,
- automatic scene start and completion transitions,
- and remove any temporary manual transcript inputs.
