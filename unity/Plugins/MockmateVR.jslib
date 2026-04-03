mergeInto(LibraryManager.library, {
  SpeakNative: function (text, objectName) {
    if (typeof window.speakNative === 'function') {
      window.speakNative(UTF8ToString(text), UTF8ToString(objectName));
    } else {
      console.error("[JSLib] window.speakNative not found in host index.html!");
    }
  },

  StopNativeSpeech: function () {
    if (typeof window.stopNativeSpeech === 'function') {
      window.stopNativeSpeech();
    }
  },

  StartNativeSTT: function (objectName) {
    if (typeof window.startNativeSTT === 'function') {
      window.startNativeSTT(UTF8ToString(objectName));
    } else {
      console.error("[JSLib] window.startNativeSTT not found in host index.html!");
    }
  },

  StopNativeSTT: function () {
    if (typeof window.stopNativeSTT === 'function') {
      window.stopNativeSTT();
    }
  },

  NotifyInterviewComplete: function () {
    if (typeof window.onInterviewComplete === 'function') {
      window.onInterviewComplete();
    } else {
      console.warn("[JSLib] window.onInterviewComplete not found in host index.html!");
    }
  }
});
