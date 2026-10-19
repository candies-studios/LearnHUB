var SCORM = (function () {
  var API = null;
  var initialized = false;

  function findAPI(win) {
    var tries = 0;
    while (win.API == null && win.parent && win.parent !== win) {
      if (++tries > 7) return null;
      win = win.parent;
    }
    return win.API;
  }

  function getAPI() {
    var api = findAPI(window);
    if (!api && window.opener) api = findAPI(window.opener);
    return api;
  }

  // Safety net: if page unloads before finish() is called, close cleanly
  window.addEventListener("beforeunload", function () {
    if (API && initialized) {
      API.LMSCommit("");
      API.LMSFinish("");
    }
  });

  return {
    init: function () {
      API = getAPI();
      if (API) initialized = API.LMSInitialize("") === "true";
      return initialized;
    },
    set: function (el, val) {
      if (API && initialized) API.LMSSetValue(el, String(val));
    },
    get: function (el) {
      if (API && initialized) return API.LMSGetValue(el);
      return "";
    },
    commit: function () {
      if (API && initialized) API.LMSCommit("");
    },
    finish: function () {
      if (API && initialized) {
        API.LMSCommit("");
        API.LMSFinish("");
        initialized = false;
        API = null;
      }
    },
    setStatus: function (s) {
      this.set("cmi.core.lesson_status", s);
      this.commit();
    },
    setScore: function (raw, min, max) {
      this.set("cmi.core.score.raw", raw);
      this.set("cmi.core.score.min", min);
      this.set("cmi.core.score.max", max);
      this.commit();
    },
    // Video and intermediate quiz pages
    complete: function () {
      this.set("cmi.core.lesson_status", "completed");
      this.commit();
      this.finish();
    },
    completeQuiz: function () {
      this.set("cmi.core.lesson_status", "completed");
      this.commit();
      this.finish();
    },
    // Final quiz: set score + "passed"/"failed"
    // SCORM 1.2 spec: "passed" and "failed" imply completion,
    // but some LMS need explicit "completed" — so we set score,
    // then status as passed/failed (which IS the completion signal in SCORM 1.2)
    completeCourse: function (totalScore, totalPossible) {
      var passed = (totalScore / totalPossible) >= 0.7;
      this.set("cmi.core.score.raw", String(totalScore));
      this.set("cmi.core.score.min", "0");
      this.set("cmi.core.score.max", String(totalPossible));
      // "passed"/"failed" are valid completion statuses in SCORM 1.2
      // We set it twice with a commit in between to ensure LMS captures it
      this.set("cmi.core.lesson_status", passed ? "passed" : "failed");
      this.commit();
      var self = this;
      setTimeout(function () {
        // Set again after commit in case LMS missed it
        if (self.get("cmi.core.lesson_status") !== (passed ? "passed" : "failed")) {
          self.set("cmi.core.lesson_status", passed ? "passed" : "failed");
        }
        self.commit();
        setTimeout(function () { self.finish(); }, 200);
      }, 300);
    }
  };
})();
