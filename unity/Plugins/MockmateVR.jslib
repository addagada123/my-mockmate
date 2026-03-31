mergeInto(LibraryManager.library, {
  SpeakNative: function (text, objectName) {
    var decodedText = UTF8ToString(text);
    var objName = UTF8ToString(objectName);
    
    if (!window.speechSynthesis) {
        console.error("Browser does not support speechSynthesis.");
        return;
    }

    // Cancel existing speech if any
    window.speechSynthesis.cancel();
    
    var utterance = new SpeechSynthesisUtterance(decodedText);
    
    // Optional: Match voice to "alloy" style (preferred pitch/rate)
    utterance.pitch = 1.0;
    utterance.rate = 1.1; 
    
    utterance.onstart = function() {
        console.log("SpeechSynthesis onstart");
        SendMessage(objName, "OnSpeakStart");
    };
    
    utterance.onend = function() {
        console.log("SpeechSynthesis onend");
        SendMessage(objName, "OnSpeakEnd");
    };
    
    utterance.onerror = function(event) {
        console.error("SpeechSynthesis error", event);
        SendMessage(objName, "OnSpeakEnd"); // Force end on error to unlock flow
    };

    window.speechSynthesis.speak(utterance);
  },

  StartNativeSTT: function (objectName) {
    var objName = UTF8ToString(objectName);
    var recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    
    if (!recognition) {
        console.error("Browser does not support SpeechRecognition.");
        return;
    }

    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = function(event) {
        var transcript = event.results[0][0].transcript;
        console.log("SpeechRecognition result: " + transcript);
        SendMessage(objName, "OnTranscriptionReceived", transcript);
    };

    recognition.onerror = function(event) {
        console.error("SpeechRecognition error", event.error);
    };

    recognition.onend = function() {
        console.log("SpeechRecognition onend");
    };

    recognition.start();
  }
});
