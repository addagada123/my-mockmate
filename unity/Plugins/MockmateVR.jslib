mergeInto(LibraryManager.library, {
  SpeakNative: function (text, objectName) {
    if (typeof window.speakNative === 'function') {
      window.speakNative(UTF8ToString(text), UTF8ToString(objectName));
    } else {
      console.error("[JSLib] window.speakNative not found in host index.html!");
    }
  },

  StartNativeSTT: function (objectName) {
    if (typeof window.startNativeSTT === 'function') {
      window.startNativeSTT(UTF8ToString(objectName));
    } else {
      console.error("[JSLib] window.startNativeSTT not found in host index.html!");
    }
  }
});
