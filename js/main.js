var csInterface = new CSInterface();
var EXTENSION_ROOT = (function() { try { return new CSInterface().getSystemPath(SystemPath.EXTENSION); } catch(e) { return ""; } })();
var HEAD_EMOTIONS = ["happy", "laughing", "sad", "angry", "shocked", "scared", "confused", "disgusted", "love", "neutral"];
var headsCharacters = [];      // [{ name, images: [{ path, tags: [emotion...] }] }]
var editingCharacter = null;   // name of character currently being edited
var appConfig = { presetA:"", presetB:"", characters:[], silenceTrim:true, silenceThreshold:-50, useAI:true, noOverlap:true, fillGaps:false, applyPresets:true, motionPop:true, videoTrack:2, minDuration:0.05, minimumExpressionDuration:1.0, maximumExpressionDuration:4.0 };
var activeRun = null;
var spinnerFrames = ["\\", "|", "/", "-"];
var spinnerIndex = 0;
var spinnerTimer = null;
var deepConsoleVisible = false;

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function escapeHtml(value) { return String(value || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function log(message) { var box = document.getElementById("consoleLog"); box.innerText = "[" + new Date().toLocaleTimeString() + "] " + message + "\n" + box.innerText; }
function deepLog(message) { var box = document.getElementById("consoleDeep"); if (!box) return; box.innerText = "[" + new Date().toLocaleTimeString() + "] " + message + "\n" + box.innerText; }

function saveCharacters() { try { localStorage.setItem("opencut_characters_v1", JSON.stringify(headsCharacters)); } catch(e) {} }
function loadCharacters() { try { headsCharacters = JSON.parse(localStorage.getItem("opencut_characters_v1") || "[]"); } catch(e) { headsCharacters = []; } }
function findCharacter(name) { return headsCharacters.find(function(c) { return c.name === name; }); }

function renderHeadsCharacters() {
    var container = document.getElementById("headsCharacterList");
    if (!container) return;
    container.innerHTML = "";
    headsCharacters.forEach(function(c) {
        var card = document.createElement("div");
        card.className = "character-card" + (editingCharacter === c.name ? " selected" : "");
        var info = document.createElement("div");
        info.innerHTML = '<div class="character-card-name">' + escapeHtml(c.name) + '</div><div class="character-card-meta">' + (c.images ? c.images.length : 0) + ' head image(s)</div>';
        var actions = document.createElement("div");
        actions.className = "character-card-actions";
        var editBtn = document.createElement("button"); editBtn.textContent = "⋮"; editBtn.title="edit";
        editBtn.addEventListener("click", function() { openCharacterEditor(c.name); });
        var delBtn = document.createElement("button"); delBtn.textContent = "✕"; delBtn.title="delete";
        delBtn.addEventListener("click", function() {
            headsCharacters = headsCharacters.filter(function(x) { return x.name !== c.name; });
            if (editingCharacter === c.name) editingCharacter = null;
            saveCharacters(); renderHeadsCharacters(); renderTracks();
        });
        actions.appendChild(editBtn); actions.appendChild(delBtn);
        card.appendChild(info); card.appendChild(actions);
        card.addEventListener("click", function() { openCharacterEditor(c.name); });
        container.appendChild(card);
    });
}

function openCharacterEditor(name) {
    editingCharacter = name;
    document.getElementById("lblEditingCharacter").innerText = "editing: " + name + " (click heads to tag)";
    document.getElementById("characterEditor").classList.remove("hidden");
    renderHeadsCharacters();
    renderHeadImages();
}

function renderHeadImages() {
    var grid = document.getElementById("headImagesGrid");
    if (!grid) return;
    grid.innerHTML = "";
    var c = editingCharacter ? findCharacter(editingCharacter) : null;
    if (!c || !c.images || c.images.length === 0) {
        grid.innerHTML = '<div style="color:#71717a; font-size:11px; text-align:center; padding:10px;">no heads yet — drop images above.</div>';
        return;
    }
    c.images.forEach(function(img, idx) {
        var cardEl = document.createElement("div");
        cardEl.className = "head-image-card";
        var imgTag = document.createElement("img");
        imgTag.src = img.path;
        imgTag.onerror = function() { imgTag.style.display = "none"; };
        var nameEl = document.createElement("div");
        nameEl.className = "head-image-name";
        nameEl.textContent = (img.path || "").split(/[\\/]/).pop();
        var tagsEl = document.createElement("div");
        tagsEl.className = "head-tags";
        HEAD_EMOTIONS.forEach(function(em) {
            var t = document.createElement("span");
            t.className = "head-tag" + (img.tags.indexOf(em) !== -1 ? " active" : "");
            t.textContent = em;
            t.addEventListener("click", function() {
                var pos = img.tags.indexOf(em);
                if (pos === -1) img.tags.push(em); else img.tags.splice(pos, 1);
                saveCharacters(); renderHeadImages();
            });
            tagsEl.appendChild(t);
        });
        var rm = document.createElement("button");
        rm.className = "head-image-remove";
        rm.textContent = "✕";
        rm.addEventListener("click", function() {
            c.images.splice(idx, 1);
            saveCharacters(); renderHeadImages(); renderHeadsCharacters();
        });
        cardEl.appendChild(imgTag);
        cardEl.appendChild(nameEl);
        cardEl.appendChild(tagsEl);
        cardEl.appendChild(rm);
        grid.appendChild(cardEl);
    });
}

function importHeadImages(filePaths) {
    if (!editingCharacter || !filePaths || !filePaths.length) return;
    var c = findCharacter(editingCharacter);
    if (!c) return;
    var folder = EXTENSION_ROOT + "\\assets\\characters\\" + editingCharacter;
    hostCall("copyFilesToFolder", JSON.stringify({ folder: folder, files: filePaths }), function(raw) {
        var res; try { res = JSON.parse(raw); } catch(e) {}
        if (res && res.success) {
            res.results.forEach(function(r) {
                if (r.success) c.images.push({ path: r.dest.replace(/\\/g, "/"), tags: [] });
            });
            saveCharacters(); renderHeadImages(); renderHeadsCharacters();
            log("Imported " + res.results.filter(function(r){return r.success;}).length + " head image(s) into " + editingCharacter + ".");
        } else {
            log("Head import failed: " + (res ? res.error : raw));
        }
    });
}

function normalizeCharacters(characters) {
    // Legacy mapping no longer needed — routing now holds { track, characterName }.
    return (characters || []).map(function(c, i) {
        return { track: parseInt(c.track, 10) || (i + 1), characterName: c.characterName || "" };
    });
}

function setTaskState(task, state) { var node = document.querySelector('[data-task="' + task + '"]'); if (node) node.className = state || ""; }
function setProgress(percent, title, detail, task, state) {
    percent = Math.max(0, Math.min(100, Math.round(percent)));
    var pPct = document.getElementById("progressPercent"); if (pPct) pPct.innerText = percent + "%";
    var pFill = document.getElementById("progressFill"); if (pFill) pFill.style.width = percent + "%";
    var pTitle = document.getElementById("progressTitle"); if (pTitle) pTitle.innerText = title;
    var pDetail = document.getElementById("progressDetail"); if (pDetail) pDetail.innerText = detail;
    if (task) setTaskState(task, state || "active");
    if (typeof updateHeadsOverlayStep === "function") updateHeadsOverlayStep(percent, title);
}
function setCardState(state) { var pc = document.getElementById("progressCard"); if (pc) pc.className = "progress-card " + (state || ""); }
function setBusy(busy) { var g = document.getElementById("btnGenerate"); if (g) g.disabled = busy; var c = document.getElementById("btnCancel"); if (c) c.disabled = !busy; }
function setDebugVisible(visible) {
    deepConsoleVisible = !!visible;
    var panel = document.getElementById("debugPanel");
    if (panel) panel.classList.toggle("hidden", !deepConsoleVisible);
    var button = document.getElementById("btnDebugToggle");
    if (button) button.innerText = deepConsoleVisible ? "Hide Deep Console (F10)" : "Show Deep Console (F10)";
}
function startSpinner() {
    if (spinnerTimer) clearInterval(spinnerTimer);
    var spEl = document.getElementById("spinner");
    spinnerTimer = setInterval(function() { spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length; if (spEl) spEl.innerText = spinnerFrames[spinnerIndex]; if (activeRun) { var el = document.getElementById("elapsed"); if (el) el.innerText = "Elapsed: " + Math.floor((Date.now() - activeRun.startedAt) / 1000) + "s"; } }, 180);
}
function stopSpinner() { if (spinnerTimer) clearInterval(spinnerTimer); spinnerTimer = null; var spEl = document.getElementById("spinner"); if (spEl) spEl.innerText = "-"; }
function finishRun(success, message) {
    if (!activeRun) return;
    activeRun.cancelled = true;
    if (activeRun.poller) clearInterval(activeRun.poller);
    activeRun = null;
    stopSpinner(); setBusy(false); setCardState(success ? "complete" : "error");
    if (typeof finishProcessOverlay === "function") finishProcessOverlay(success, message);
    if (success) { setProgress(100, "Complete", message, "placement", "done"); log(message); }
    else { var pPctEl = document.getElementById("progressPercent"); setProgress(parseInt(pPctEl ? pPctEl.innerText : "0", 10) || 0, "Needs attention", message, null); log(message); }
}

function hostCall(name, argument, callback, timeoutMs) {
    var completed = false;
    var jsxPath = (EXTENSION_ROOT + "\\jsx\\hostscript.jsx").replace(/\\/g, "/");
    var script = 'try { $.evalFile("' + jsxPath + '"); } catch(eEval) {}; ' + name + "(" + (argument === undefined ? "" : JSON.stringify(argument)) + ")";
    var timer = setTimeout(function() {
        if (completed) return;
        completed = true;
        var secs = Math.round((timeoutMs || 20000) / 1000);
        var message = "Premiere did not answer " + name + " after " + secs + " seconds. Keep the sequence open, then try again.";
        var silLog = document.getElementById("consoleLogSilences");
        if (silLog && currentView === "silences" && typeof logSilences === "function") {
            logSilences("timeout: " + message);
        } else if (activeRun) {
            finishRun(false, message);
        } else {
            log(message);
        }
    }, timeoutMs || 20000);
    try {
        csInterface.evalScript(script, function(result) {
            if (completed) return;
            completed = true; clearTimeout(timer);
            callback(result);
        });
    } catch (error) {
        clearTimeout(timer);
        if (activeRun) finishRun(false, "Could not call Premiere: " + error.message);
    }
}

function loadConfig() {
    loadCharacters();
    try {
        var saved = JSON.parse(localStorage.getItem("auto_heads_config_v10") || "null");
        if (!saved) return;
        ["presetA","presetB","silenceTrim","silenceThreshold","useAI","fillGaps","applyPresets","motionPop","videoTrack","minDuration","minimumExpressionDuration","maximumExpressionDuration"].forEach(function(key) { if (saved[key] !== undefined) appConfig[key] = saved[key]; });
        if (saved.characters) appConfig.characters = normalizeCharacters(saved.characters);
    } catch (error) {}
}
function gatherValues() {
    appConfig.presetA = document.getElementById("txtPresetA").value.trim().replace(/\\/g,"/");
    appConfig.presetB = document.getElementById("txtPresetB").value.trim().replace(/\\/g,"/");
    var chkSilence = document.getElementById("chkSilenceTrim");
    appConfig.silenceTrim = chkSilence ? chkSilence.checked : true;
    var numSil = document.getElementById("numSilenceThreshold");
    appConfig.silenceThreshold = numSil ? (parseFloat(numSil.value) || -50) : -50;
    appConfig.useAI = document.getElementById("chkAI").checked;
    appConfig.applyPresets = document.getElementById("chkPresets").checked;
    appConfig.motionPop = document.getElementById("chkMotionPop").checked;
    appConfig.noOverlap = true;
    appConfig.fillGaps = document.getElementById("chkFillGaps").checked;
    appConfig.videoTrack = parseInt(document.getElementById("selVideoTrack").value, 10) || 2;
    appConfig.minDuration = 0.05;
    appConfig.minimumExpressionDuration = Math.max(0.25, parseFloat(document.getElementById("numMinimumExpressionDuration").value) || 1.0);
    appConfig.maximumExpressionDuration = Math.max(appConfig.minimumExpressionDuration, parseFloat(document.getElementById("numMaximumExpressionDuration").value) || 4.0);
    // routing dropdowns
    document.querySelectorAll(".char-routing-select").forEach(function(node) { var i = parseInt(node.getAttribute("data-index"),10); if (appConfig.characters[i]) appConfig.characters[i].characterName = node.value; });
}
function saveConfig() { gatherValues(); try { localStorage.setItem("auto_heads_config_v10", JSON.stringify(appConfig)); } catch (error) {} }

function renderTracks() {
    var container = document.getElementById("characterList"); container.innerHTML = "";
    appConfig.characters.forEach(function(character, index) {
        var row = document.createElement("div");
        row.className = "char-row";
        row.style.cssText = "display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:8px; background:#18181b; border:1px solid #27272a; margin-bottom:8px;";
        var badge = document.createElement("span");
        badge.className = "track-badge";
        badge.textContent = "A" + character.track;
        badge.style.cssText = "min-width:34px; font-weight:bold; color:#8fbc8f;";
        var sel = document.createElement("select");
        sel.className = "char-routing-select";
        sel.setAttribute("data-index", index);
        sel.style.cssText = "flex:1; background:#09090b; border:1px solid #27272a; border-radius:4px; padding:6px 8px; color:#f4f4f5; font-size:12px;";
        var none = document.createElement("option");
        none.value = ""; none.textContent = "— none —"; sel.appendChild(none);
        headsCharacters.forEach(function(c) {
            var opt = document.createElement("option");
            opt.value = c.name; opt.textContent = c.name;
            if (c.name === character.characterName) opt.selected = true;
            sel.appendChild(opt);
        });
        row.appendChild(badge);
        row.appendChild(sel);
        container.appendChild(row);
    });
    document.getElementById("txtPresetA").value = appConfig.presetA; document.getElementById("txtPresetB").value = appConfig.presetB;
    var chkSilence = document.getElementById("chkSilenceTrim");
    if (chkSilence) chkSilence.checked = appConfig.silenceTrim !== false;
    var numSil = document.getElementById("numSilenceThreshold");
    if (numSil) numSil.value = appConfig.silenceThreshold !== undefined ? appConfig.silenceThreshold : -50;
    appConfig.minDuration = 0.05;
    document.getElementById("chkAI").checked = appConfig.useAI; document.getElementById("chkNoOverlap").checked = true; document.getElementById("chkFillGaps").checked = appConfig.fillGaps; document.getElementById("chkPresets").checked = appConfig.applyPresets; document.getElementById("chkMotionPop").checked = appConfig.motionPop;
    document.getElementById("selVideoTrack").value = appConfig.videoTrack; document.getElementById("numMinDuration").value = appConfig.minDuration; document.getElementById("numMinimumExpressionDuration").value = appConfig.minimumExpressionDuration; document.getElementById("numMaximumExpressionDuration").value = appConfig.maximumExpressionDuration;
}

function syncTracks() {
    log("Requesting the active sequence audio track count...");
    hostCall("getSequenceTracks", undefined, function(raw) {
        try {
            var response = JSON.parse(raw); if (response.error) throw new Error(response.error);
            var old = {}; appConfig.characters.forEach(function(item) { old[item.track] = item; });
            appConfig.characters = response.tracks.map(function(track) {
                return old[track.trackNum] || { track: track.trackNum, characterName: "" };
            });
            renderTracks(); saveConfig(); log("Synced " + response.tracks.length + " audio track row(s) from " + response.sequenceName + ".");
        } catch (error) { log("Track sync failed: " + error.message); }
    }, 10000);
}

function testHost() {
    log("Testing the Premiere connection...");
    hostCall("getHostStatus", undefined, function(raw) {
        try { var status = JSON.parse(raw); if (status.error) throw new Error(status.error); log("Connected to Premiere. Active sequence: " + status.sequenceName + "; " + status.audioTracks + " audio track(s)."); }
        catch (error) { log("Host test failed: " + error.message); }
    }, 10000);
}

function readProgress(run) {
    hostCall("readTextFile", run.progressPath, function(raw) {
        if (!activeRun || activeRun.id !== run.id || !raw || raw.indexOf("ERR_") === 0) return;
        try {
            var progress = JSON.parse(raw), task = progress.stage === "collision" ? "analysis" : progress.stage;
            setProgress(progress.percent, task === "analysis" ? "Analyzing dialogue" : "Preparing placement", progress.detail, task, "active");
            if (progress.percent >= 92) setTaskState("analysis", "done");
        } catch (error) {}
    }, 5000);
}
function pollDebugLog(run) {
    if (!activeRun || activeRun.id !== run.id || !run.logPath) return;
    hostCall("readTextFile", run.logPath, function(raw) {
        if (!activeRun || activeRun.id !== run.id || !raw || raw.indexOf("ERR_") === 0) return;
        if (run.logText === raw) return;
        var delta = raw.slice(run.logText ? run.logText.length : 0);
        run.logText = raw;
        if (delta) deepLog(delta.replace(/\r\n/g, "\n").trim());
    }, 5000);
}
function placeHeadBatches(run, events) {
    run.placementEvents = events.slice(0).sort(function(a, b) { return b.start - a.start; });
    run.placementOffset = 0;
    run.placementStats = { placedCount:0, presetFailures:0, rejectedHeads:0, clearedCount:0 };
    placeNextHeadBatch(run);
}
function placeNextHeadBatch(run) {
    if (!activeRun || activeRun.id !== run.id) return;
    var total = run.placementEvents.length;
    if (run.placementOffset >= total) {
        var stats = run.placementStats;
        var summary = "Finished: " + stats.placedCount + " head(s). A1 is on V" + appConfig.videoTrack + "; A2-A4 are on V" + (appConfig.videoTrack + 1) + (stats.clearedCount ? "; " + stats.clearedCount + " prior generated head(s) replaced" : "") + (stats.presetFailures ? "; " + stats.presetFailures + " preset fallback(s)" : "") + (stats.rejectedHeads ? "; " + stats.rejectedHeads + " rejected head(s)" : "") + ".";
        finishRun(true, summary);
        return;
    }
    var batchSize = 8;
    var batchEnd = Math.min(total, run.placementOffset + batchSize);
    var batch = run.placementEvents.slice(run.placementOffset, batchEnd);
    var percent = 95 + Math.floor(5 * run.placementOffset / total);
    setProgress(percent, "Placing heads", "Placing heads " + (run.placementOffset + 1) + "-" + batchEnd + " of " + total + " on V" + appConfig.videoTrack + "/V" + (appConfig.videoTrack + 1) + ".", "placement", "active");
    hostCall("placeHeadsFromPlan", JSON.stringify({ events:batch, videoTrack:appConfig.videoTrack, applyPresets:appConfig.applyPresets, motionPop:appConfig.motionPop, clearExisting:run.placementOffset === 0 }), function(rawPlacement) {
        if (!activeRun || activeRun.id !== run.id) return;
        try {
            var placed = JSON.parse(rawPlacement);
            if (placed.error) throw new Error(placed.error);
            run.placementStats.placedCount += placed.placedCount || 0;
            run.placementStats.presetFailures += placed.presetFailures || 0;
            run.placementStats.rejectedHeads += placed.rejectedHeads || 0;
            run.placementStats.clearedCount += placed.clearedCount || 0;
            run.placementOffset = batchEnd;
            setTimeout(function() { placeNextHeadBatch(run); }, 25);
        } catch (error) { finishRun(false, "Placement batch " + (run.placementOffset + 1) + "-" + batchEnd + " failed: " + error.message); }
    }, 60000);
}
function pollRun(run) {
    if (!activeRun || activeRun.id !== run.id || run.polling) return;
    run.polling = true;
    readProgress(run);
    hostCall("readTextFile", run.outputPath, function(raw) {
        run.polling = false;
        if (!activeRun || activeRun.id !== run.id || !raw || raw.indexOf("ERR_") === 0) return;
        var output;
        try { output = JSON.parse(raw); } catch (error) { return; }
        clearInterval(run.poller);
        if (!output.success) { finishRun(false, "AI backend failed: " + (output.error || "Unknown error")); return; }
        setTaskState("analysis", "done");

        if (output.trimOps && output.trimOps.length > 0) {
            setProgress(94, "Trimming audio clips", "Trimming dead space from " + output.trimOps.length + " audio clip(s)...", "timeline", "active");
            log("Trimming timeline audio clips to spoken dialogue: " + output.trimOps.length + " clip(s)...");
            hostCall("trimTimelineAudioClips", JSON.stringify({ trimOps: output.trimOps }), function(rawAudio) {
                if (!activeRun || activeRun.id !== run.id) return;
                try {
                    var audioResult = JSON.parse(rawAudio);
                    if (audioResult.error) log("Note on timeline audio trim: " + audioResult.error);
                    else log("Timeline audio clips cut: " + (audioResult.razorCount || 0) + " razor cut(s), " + (audioResult.removedCount || 0) + " silent piece(s) removed" + (audioResult.razorFailures ? ", " + audioResult.razorFailures + " razor verification failure(s) left untouched" : "") + ".");
                } catch (eAudio) {}
                placeHeadBatches(run, output.events);
            }, 60000);
        } else {
            placeHeadBatches(run, output.events);
        }
    }, 5000);
}

function startRun() {
    if (activeRun) return;
    gatherValues(); saveConfig();
    document.querySelectorAll(".task-list span").forEach(function(node) { node.className = ""; });
    activeRun = { id:Date.now(), startedAt:Date.now(), cancelled:false, poller:null, polling:false };
    var run = activeRun;
    setBusy(true); setCardState("running"); startSpinner(); setProgress(3, "Checking Premiere", "Confirming that Premiere has an active sequence.", "host", "active"); log("Run started.");
    if (typeof showProcessOverlay === "function") showProcessOverlay("heads");
    hostCall("getHostStatus", undefined, function(rawStatus) {
        if (activeRun !== run) return;
        var status;
        try { status = JSON.parse(rawStatus); if (status.error) throw new Error(status.error); } catch (error) { finishRun(false, "Premiere host check failed: " + error.message); return; }
        setTaskState("host", "done"); setProgress(12, "Reading timeline cuts", "Scanning " + status.audioTracks + " audio track(s) for eligible dialogue clips.", "timeline", "active");
    hostCall("getTimelineAudioClips", JSON.stringify(appConfig), function(rawTimeline) {
            if (activeRun !== run) return;
            var timeline;
            try { timeline = JSON.parse(rawTimeline); if (timeline.error) throw new Error(timeline.error); if (!timeline.clips.length) throw new Error("No audio clips met the minimum duration."); } catch (error) { finishRun(false, "Timeline read failed: " + error.message); return; }
            setTaskState("timeline", "done"); setProgress(25, "Starting local AI", "Found " + timeline.clips.length + " cut(s). Preparing the Python request.", "analysis", "active");
            hostCall("getRuntimeFolder", undefined, function(runtimeFolder) {
                if (activeRun !== run) return;
                if (!runtimeFolder || runtimeFolder.indexOf("ERR") === 0) { finishRun(false, "Could not create a writable runtime folder: " + runtimeFolder); return; }
                run.requestPath = runtimeFolder + "\\autoheads_request_" + run.id + ".json";
                run.outputPath = runtimeFolder + "\\autoheads_output_" + run.id + ".json";
                run.progressPath = runtimeFolder + "\\autoheads_progress_" + run.id + ".json";
                run.logPath = runtimeFolder + "\\autoheads_debug_" + run.id + ".log";
                run.logText = "";
                var request = { characters: appConfig.characters.map(function(c) { var ch = findCharacter(c.characterName); if (!ch) return null; return { trackIndex: c.track - 1, name: ch.name, images: ch.images || [] }; }).filter(function(x){ return x; }), clips:timeline.clips, presetA:appConfig.presetA, presetB:appConfig.presetB, silenceTrim:appConfig.silenceTrim, silenceThreshold:appConfig.silenceThreshold, useAI:appConfig.useAI, noOverlap:true, fillGaps:appConfig.fillGaps, minimumExpressionDuration:appConfig.minimumExpressionDuration, maximumExpressionDuration:appConfig.maximumExpressionDuration, progressPath:run.progressPath };
                hostCall("writeTextFile", JSON.stringify({ path:run.requestPath, text:JSON.stringify(request) }), function(writeResult) {
                    if (activeRun !== run) return;
                    if (writeResult !== "OK") { finishRun(false, "Could not write AI request: " + writeResult); return; }
                    try {
                        var python = "C:\\Program Files\\Python313\\python.exe", script = EXTENSION_ROOT + "\\ai_processor.py";
                        hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:run.requestPath, output:run.outputPath, logPath:run.logPath }), function(batchResult) {
                            if (activeRun !== run) return;
                            if (batchResult !== "OK") { finishRun(false, "Python launch failed: " + batchResult); return; }
                        }, 10000);
                    } catch (error) { finishRun(false, "Python launch failed: " + error.message); return; }
                    setProgress(30, "Analyzing dialogue", "Python started. Progress will update while audio is mixed and transcribed.", "analysis", "active");
                    run.poller = setInterval(function() { pollDebugLog(run); pollRun(run); }, 700); pollDebugLog(run); pollRun(run);
                }, 15000);
            }, 10000);
        }, 30000);
    }, 10000);
}

var currentView = "hub";

function switchView(viewName) {
    currentView = viewName || "hub";
    document.querySelectorAll(".app-view").forEach(function(el) {
        el.classList.remove("active");
    });
    var targetId = viewName === "heads" ? "viewHeads" : (viewName === "sfx" ? "viewSFX" : "viewHub");
    var target = document.getElementById(targetId);
    if (target) target.classList.add("active");

    var backBtn = document.getElementById("btnBackToHub");
    if (backBtn) {
        if (currentView === "hub") {
            backBtn.classList.add("hidden");
        } else {
            backBtn.classList.remove("hidden");
        }
    }
    try { localStorage.setItem("opencut_active_view", currentView); } catch(e) {}
}

var TAG_OPTIONS = [
    "shocked / dramatic",
    "funny / awkward",
    "exciting / hype",
    "sad / defeat",
    "impact / action"
];

var sfxLibrary = [
    // add your own sfx files here, e.g.:
    // { id:"sfx_1", name:"example.wav", tag:"funny", duration:1.5, path:"C:/path/to/example.wav" }
];

var sfxConfig = {
    populationRate: 45,
    volumeDb: -12,
    targetTrack: 5,
    snapToCut: true,
    flagLoudRed: true,
    ggufPath: ""
};

var activeAudio = null;
var activePlayingId = null;

// Waveform Trimmer State
var audioCtx = null;
var activeTrimmerItem = null;
var trimmerAudioBuffer = null;
var trimmerInSec = 0;
var trimmerOutSec = 0;
var trimmerDuration = 0;
var isDraggingHandle = null;
var activeSourceNode = null;

function getAudioContext() {
    if (!audioCtx) {
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    return audioCtx;
}

function loadSfxState() {
    try {
        var savedLib = JSON.parse(localStorage.getItem("opencut_sfx_library_v2") || "null");
        if (savedLib && Array.isArray(savedLib) && savedLib.length) sfxLibrary = savedLib;
        var savedCfg = JSON.parse(localStorage.getItem("opencut_sfx_config_v2") || "null");
        if (savedCfg) {
            Object.keys(savedCfg).forEach(function(k) { sfxConfig[k] = savedCfg[k]; });
        }
    } catch(e) {}

    var rng = document.getElementById("rngPopulationRate");
    if (rng) rng.value = sfxConfig.populationRate;
    updatePopulationLabel(sfxConfig.populationRate);

    var numVol = document.getElementById("numSfxVolume");
    if (numVol) numVol.value = sfxConfig.volumeDb;

    var selTrack = document.getElementById("selSfxTrack");
    if (selTrack) selTrack.value = String(sfxConfig.targetTrack);

    var chkSnap = document.getElementById("chkSnapToCut");
    if (chkSnap) chkSnap.checked = sfxConfig.snapToCut !== false;

    var chkRed = document.getElementById("chkFlagLoudRed");
    if (chkRed) chkRed.checked = sfxConfig.flagLoudRed !== false;

    var txtGguf = document.getElementById("txtGgufPath");
    if (txtGguf) txtGguf.value = sfxConfig.ggufPath || "";

    renderSfxLibrary();
}

function saveSfxState() {
    var rng = document.getElementById("rngPopulationRate");
    if (rng) sfxConfig.populationRate = parseInt(rng.value, 10) || 45;

    var numVol = document.getElementById("numSfxVolume");
    if (numVol) sfxConfig.volumeDb = parseFloat(numVol.value) || -12;

    var selTrack = document.getElementById("selSfxTrack");
    if (selTrack) sfxConfig.targetTrack = parseInt(selTrack.value, 10) || 5;

    var chkSnap = document.getElementById("chkSnapToCut");
    if (chkSnap) sfxConfig.snapToCut = chkSnap.checked;

    var chkRed = document.getElementById("chkFlagLoudRed");
    if (chkRed) sfxConfig.flagLoudRed = chkRed.checked;

    var txtGguf = document.getElementById("txtGgufPath");
    if (txtGguf) sfxConfig.ggufPath = txtGguf.value.trim().replace(/\\/g, "/");

    try {
        localStorage.setItem("opencut_sfx_library_v2", JSON.stringify(sfxLibrary));
        localStorage.setItem("opencut_sfx_config_v2", JSON.stringify(sfxConfig));
    } catch(e) {}
}

function updatePopulationLabel(val) {
    var lbl = document.getElementById("lblPopulationRate");
    if (lbl) {
        var est = Math.max(1, Math.round(val * 0.85));
        lbl.innerText = val + "% (~" + est + " SFX)";
    }
}

function logSFX(msg) {
    var box = document.getElementById("consoleLogSFX");
    if (!box) return;
    box.innerText = "[" + new Date().toLocaleTimeString() + "] " + msg + "\n" + box.innerText;
}

function logAIVoice(msg) {
    var box = document.getElementById("consoleLogAIVoice");
    if (!box) return;
    box.innerText = "[" + new Date().toLocaleTimeString() + "] " + msg + "\n" + box.innerText;
}

var selectedAIVoiceFilePath = null;

function setupAIVoiceDropZone() {
    var dropZone = document.getElementById("aiVoiceDropZone");
    var filePicker = document.getElementById("filePickerAIVoice");
    var fileSelected = document.getElementById("aiVoiceFileSelected");
    var resyncBtn = document.getElementById("btnAIVoiceResync");

    if (!dropZone || !filePicker) return;

    function handleFile(file) {
        if (!file) return;
        selectedAIVoiceFilePath = file.path;
        if (!selectedAIVoiceFilePath && file.name) {
            selectedAIVoiceFilePath = file.name;
        }
        if (fileSelected) {
            fileSelected.style.display = "block";
            fileSelected.innerText = "Selected: " + (file.name || file.path);
        }
        if (resyncBtn) {
            resyncBtn.disabled = false;
        }
        logAIVoice("Loaded AI file: " + (file.name || file.path));
    }

    dropZone.addEventListener("click", function() {
        filePicker.click();
    });

    filePicker.addEventListener("change", function(e) {
        if (e.target.files && e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    dropZone.addEventListener("dragover", function(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = "#8fbc8f";
        dropZone.style.background = "rgba(143, 188, 143, 0.12)";
    });

    dropZone.addEventListener("dragleave", function(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = "rgba(143, 188, 143, 0.5)";
        dropZone.style.background = "rgba(143, 188, 143, 0.04)";
    });

    dropZone.addEventListener("drop", function(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = "rgba(143, 188, 143, 0.5)";
        dropZone.style.background = "rgba(143, 188, 143, 0.04)";
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });
}

function prepAIVoiceTrack() {
    var trackEl = document.getElementById("selAIVoiceTrack");
    var trackIndex = trackEl ? parseInt(trackEl.value, 10) - 1 : 1;

    var threshEl = document.getElementById("numAIVoiceSilenceDb");
    var threshold = threshEl ? parseFloat(threshEl.value) || -40 : -40;

    logAIVoice("Rendering solo Track A" + (trackIndex + 1) + " directly from Premiere timeline...");

    hostCall("exportSoloTrackAudio", trackIndex.toString(), function(rawRes) {
        var res;
        try { res = JSON.parse(rawRes); } catch(e) { logAIVoice("Error exporting track audio from Premiere."); return; }
        if (res.error) { logAIVoice("Error rendering track: " + res.error); return; }
        if (!res.wavPath) { logAIVoice("No rendered WAV path returned."); return; }

        var trueSequenceEnd = res.trueSequenceEnd || 0.0;
        logAIVoice("Track A" + (trackIndex + 1) + " rendered cleanly from timeline! Analyzing silences with AI...");

        var runId = Date.now();
        hostCall("getRuntimeFolder", undefined, function(runtimeFolder) {
            if (!runtimeFolder || runtimeFolder.indexOf("ERR") === 0) { logAIVoice("Could not access runtime folder."); return; }
            var reqPath = runtimeFolder + "\\aivoice_prep_req_" + runId + ".json";
            var outPath = runtimeFolder + "\\aivoice_prep_out_" + runId + ".json";
            var logPath = runtimeFolder + "\\aivoice_prep_log_" + runId + ".log";
            
            var request = {
                mode: "prep_ai_voice",
                trackIndex: trackIndex,
                timelineWav: res.wavPath,
                threshold: threshold
            };

            hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(request) }), function(writeRes) {
                if (writeRes !== "OK") { logAIVoice("Error writing AI prep request."); return; }
                var python = "C:\\Program Files\\Python313\\python.exe";
                var script = EXTENSION_ROOT + "\\ai_processor.py";

                hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:reqPath, output:outPath, logPath:logPath }), function(bRes) {
                    var pollTimer = setInterval(function() {
                        hostCall("readTextFile", outPath, function(outContent) {
                            if (outContent && outContent.indexOf("success") !== -1) {
                                clearInterval(pollTimer);
                                try {
                                    var output = JSON.parse(outContent);
                                    if (output.success && output.chunks) {
                                        output.trackIndex = trackIndex;
                                        output.trueSequenceEnd = trueSequenceEnd;
                                        logAIVoice("Detected " + output.chunks.length + " spoken segments. Placing pure WAV after end of video (" + (trueSequenceEnd + 5.0).toFixed(1) + "s)...");
                                        
                                        // Call ExtendScript to place pure WAV clips at end of track and set In/Out markers
                                        hostCall("buildCondensedAIVoiceSequence", JSON.stringify(output), function(buildResRaw) {
                                            var bRes;
                                            try { bRes = JSON.parse(buildResRaw); } catch(e) {}
                                            if (bRes && bRes.success) {
                                                output.prepStartTime = bRes.prepStartTime;
                                                output.prepEndTime = bRes.prepEndTime;
                                                var mapPath = runtimeFolder + "\\aivoice_sync_map.json";
                                                hostCall("writeTextFile", JSON.stringify({ path: mapPath, text: JSON.stringify(output) }), function() {
                                                    logAIVoice(bRes.message);
                                                });
                                            } else {
                                                logAIVoice("Error placing prep audio: " + (bRes ? bRes.error : buildResRaw));
                                            }
                                        });
                                    } else {
                                        logAIVoice("Error generating prep segments: " + (output.error || "Unknown"));
                                    }
                                } catch(e) { logAIVoice("Error parsing prep output."); }
                            }
                        });
                    }, 500);
                });
            });
        });
    });
}

function resyncAIVoiceTrack() {
    if (!selectedAIVoiceFilePath) {
        logAIVoice("Please drop or browse for your ElevenLabs audio file first.");
        return;
    }

    logAIVoice("Loading sync map and ElevenLabs audio: " + selectedAIVoiceFilePath.split("\\").pop() + "...");
    hostCall("getRuntimeFolder", undefined, function(runtimeFolder) {
        var mapPath = runtimeFolder + "\\aivoice_sync_map.json";
        hostCall("readTextFile", mapPath, function(mapContent) {
            if (!mapContent || mapContent.indexOf("success") === -1) {
                logAIVoice("Error: Could not find 'aivoice_sync_map.json'. Did you run Step 1 first?");
                return;
            }
            
            var syncMap;
            try { syncMap = JSON.parse(mapContent); } catch(e) { logAIVoice("Error parsing sync map."); return; }
            
            if (!syncMap.chunks || syncMap.chunks.length === 0) {
                logAIVoice("No chunks found in sync map.");
                return;
            }
            
            logAIVoice("Sync map has " + syncMap.chunks.length + " segments. Inserting New Track A" + (parseInt(syncMap.trackIndex, 10) + 2) + " & aligning waveforms...");
            
            var payload = {
                aiAudioPath: selectedAIVoiceFilePath,
                syncMap: syncMap
            };
            
            hostCall("resyncElevenLabsAudio", JSON.stringify(payload), function(resyncRaw) {
                var res;
                try { res = JSON.parse(resyncRaw); } catch(e) {}
                if (res && res.success) {
                    logAIVoice(res.message);
                } else {
                    logAIVoice("Resync result: " + (res ? res.error : resyncRaw));
                }
            });
        });
    });
}

function autoGenerateAIVoiceTrack() {
    var apiKeyEl = document.getElementById("txtElevenLabsApiKey");
    var apiKey = apiKeyEl ? apiKeyEl.value.trim() : "";
    if (!apiKey) {
        logAIVoice("Please enter your ElevenLabs API Key in the settings above.");
        return;
    }

    var voiceEl = document.getElementById("selElevenLabsVoice");
    var voiceId = voiceEl ? voiceEl.value : "6u6JbqKdaQy89ENzLSju";
    var voiceName = voiceEl ? voiceEl.options[voiceEl.selectedIndex].text.split(" - ")[0] : "Brielle";

    logAIVoice("Checking prepped audio for ElevenLabs conversion...");

    hostCall("getRuntimeFolder", undefined, function(runtimeFolder) {
        if (!runtimeFolder || runtimeFolder.indexOf("ERR") === 0) { logAIVoice("Could not access runtime folder."); return; }
        var mapPath = runtimeFolder + "\\aivoice_sync_map.json";

        hostCall("readTextFile", mapPath, function(mapContent) {
            if (!mapContent || mapContent.indexOf("success") === -1) {
                logAIVoice("Error: Could not find prepped audio. Please run Step 1 (Prep Track) first!");
                return;
            }

            var syncMap;
            try { syncMap = JSON.parse(mapContent); } catch(e) { logAIVoice("Error parsing sync map."); return; }
            if (!syncMap.consolidatedWav) {
                logAIVoice("Error: No consolidated WAV found in sync map. Please run Step 1 first.");
                return;
            }

            logAIVoice("Calling ElevenLabs Speech-to-Speech (" + voiceName + ") with " + syncMap.chunks.length + " dialogue lines...");

            var runId = Date.now();
            var reqPath = runtimeFolder + "\\elevenlabs_req_" + runId + ".json";
            var outPath = runtimeFolder + "\\elevenlabs_out_" + runId + ".json";
            var logPath = runtimeFolder + "\\elevenlabs_log_" + runId + ".log";

            var request = {
                mode: "elevenlabs_sts",
                apiKey: apiKey,
                voiceId: voiceId,
                audioPath: syncMap.consolidatedWav
            };

            hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(request) }), function(writeRes) {
                if (writeRes !== "OK") { logAIVoice("Error writing ElevenLabs request."); return; }

                var python = "C:\\Program Files\\Python313\\python.exe";
                var script = EXTENSION_ROOT + "\\ai_processor.py";

                hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:reqPath, output:outPath, logPath:logPath }), function(bRes) {
                    var pollTimer = setInterval(function() {
                        hostCall("readTextFile", outPath, function(outContent) {
                            if (outContent && (outContent.indexOf("success") !== -1 || outContent.indexOf("error") !== -1)) {
                                clearInterval(pollTimer);
                                try {
                                    var output = JSON.parse(outContent);
                                    if (output.success && output.aiAudioPath) {
                                        logAIVoice("ElevenLabs voice generated successfully! Automatically resyncing onto timeline...");

                                        var payload = {
                                            aiAudioPath: output.aiAudioPath,
                                            syncMap: syncMap
                                        };

                                        hostCall("resyncElevenLabsAudio", JSON.stringify(payload), function(resyncRaw) {
                                            var res;
                                            try { res = JSON.parse(resyncRaw); } catch(e) {}
                                            if (res && res.success) {
                                                logAIVoice(res.message);
                                            } else {
                                                logAIVoice("Resync result: " + (res ? res.error : resyncRaw));
                                            }
                                        });
                                    } else {
                                        logAIVoice("ElevenLabs error: " + (output.error || "Unknown failure"));
                                    }
                                } catch(e) { logAIVoice("Error parsing ElevenLabs output."); }
                            }
                        });
                    }, 1000);
                });
            });
        });
    });
}

function oneClickAutoAIVoice() {
    var apiKeyEl = document.getElementById("txtElevenLabsApiKey");
    var apiKey = apiKeyEl ? apiKeyEl.value.trim() : "";
    if (!apiKey) {
        logAIVoice("Please enter your ElevenLabs API Key above.");
        return;
    }

    var voiceEl = document.getElementById("selElevenLabsVoice");
    var voiceId = voiceEl ? voiceEl.value : "6u6JbqKdaQy89ENzLSju";
    var voiceName = voiceEl ? voiceEl.options[voiceEl.selectedIndex].text.split(" - ")[0] : "Brielle";

    var trackSelect = document.getElementById("selAIVoiceTrack");
    var trackIndex = trackSelect ? (parseInt(trackSelect.value, 10) - 1) : 1;

    var silenceInput = document.getElementById("numAIVoiceSilenceDb");
    var thresholdDb = silenceInput ? parseFloat(silenceInput.value) : -40.0;

    var btn = document.getElementById("btnAIVoiceOneClick");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "converting voice with ai...";
    }

    function resetButton() {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "convert voice with ai";
        }
    }

    logAIVoice("[1/3] Rendering Track A" + (trackIndex + 1) + " directly from Premiere timeline...");
    if (typeof showProcessOverlay === "function") showProcessOverlay("aivoice", "rendering track a" + (trackIndex + 1) + "...");

    hostCall("exportSoloTrackAudio", trackIndex.toString(), function(rawRes) {
        var res;
        try { res = JSON.parse(rawRes); } catch(e) {}
        if (!res || !res.success || !res.wavPath) {
            logAIVoice("Error exporting timeline audio: " + (res ? res.error : rawRes));
            finishProcessOverlay(false, "timeline render failed: " + (res ? res.error : "unknown"));
            resetButton();
            return;
        }
        advanceProcessStep(1);

        var timelineWav = res.wavPath;
        var trueSequenceEnd = res.trueSequenceEnd ? parseFloat(res.trueSequenceEnd) : 0.0;

        logAIVoice("[2/3] Condensing dialogue & converting to " + voiceName + " via ElevenLabs API...");

        hostCall("getRuntimeFolder", undefined, function(runtimeFolder) {
            if (!runtimeFolder || runtimeFolder.indexOf("ERR") === 0) {
                logAIVoice("Could not access runtime folder.");
                resetButton();
                return;
            }

            var runId = Date.now();
            var reqPath = runtimeFolder + "\\aivoice_1click_req_" + runId + ".json";
            var outPath = runtimeFolder + "\\aivoice_1click_out_" + runId + ".json";
            var logPath = runtimeFolder + "\\aivoice_1click_log_" + runId + ".log";

            var request = {
                mode: "auto_ai_voice",
                timelineWav: timelineWav,
                trackIndex: trackIndex,
                threshold: thresholdDb,
                apiKey: apiKey,
                voiceId: voiceId
            };

            hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(request) }), function(writeRes) {
                if (writeRes !== "OK") {
                    logAIVoice("Error writing AI voice request.");
                    resetButton();
                    return;
                }

                var python = "C:\\Program Files\\Python313\\python.exe";
                var script = EXTENSION_ROOT + "\\ai_processor.py";
                hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:reqPath, output:outPath, logPath:logPath }), function() {
                    advanceProcessStep(2);
                    var pollTimer = setInterval(function() {

                        hostCall("readTextFile", outPath, function(outContent) {
                            if (outContent && (outContent.indexOf("success") !== -1 || outContent.indexOf("error") !== -1)) {
                                clearInterval(pollTimer);
                                try {
                                    var output = JSON.parse(outContent);
                                    if (output.success && output.aiAudioPath) {
                                        advanceProcessStep(3);
                                        logAIVoice("[3/3] Inserting New Track A" + (trackIndex + 2) + " & aligning " + output.chunks.length + " dialogue lines...");

                                        output.trueSequenceEnd = trueSequenceEnd;
                                        var mapPath = runtimeFolder + "\\aivoice_sync_map.json";
                                        hostCall("writeTextFile", JSON.stringify({ path: mapPath, text: JSON.stringify(output) }), function() {});

                                        var payload = {
                                            aiAudioPath: output.aiAudioPath,
                                            syncMap: output
                                        };

                                        hostCall("resyncElevenLabsAudio", JSON.stringify(payload), function(resyncRaw) {
                                            advanceProcessStep(4);
                                            resetButton();
                                            var rRes;
                                            try { rRes = JSON.parse(resyncRaw); } catch(e) {}
                                            if (rRes && rRes.success) {
                                                logAIVoice(rRes.message);
                                                finishProcessOverlay(true, rRes.message);
                                            } else {
                                                logAIVoice("Resync result: " + (rRes ? rRes.error : resyncRaw));
                                                finishProcessOverlay(false, "resync failed: " + (rRes ? rRes.error : "unknown"));
                                            }
                                        });
                                    } else {
                                        resetButton();
                                        logAIVoice("Error generating AI voice: " + (output.error || "Unknown failure"));
                                        finishProcessOverlay(false, "ai voice failed: " + (output.error || "unknown"));
                                    }
                                } catch(e) {
                                    resetButton();
                                    logAIVoice("Error parsing output: " + e.toString());
                                    finishProcessOverlay(false, "error parsing output: " + e.toString());
                                }
                            }
                        });
                    }, 1000);
                });
            });
        });
    });
}

function renderSfxLibrary() {
    var container = document.getElementById("sfxLibraryContainer");
    if (!container) return;

    if (!sfxLibrary.length) {
        container.innerHTML = '<div style="color:var(--text-dim); padding:12px; text-align:center;">No sound effects in library. Click "+ Add File" or "📁 Import Folder" above.</div>';
        return;
    }

    var html = "";
    sfxLibrary.forEach(function(item, idx) {
        var isPlaying = (activePlayingId === item.id);
        var durStr = (item.duration ? parseFloat(item.duration).toFixed(1) + "s" : "");

        html += '<div class="sfx-item" data-id="' + escapeHtml(item.id) + '">';
        html += '  <button class="sfx-play-btn ' + (isPlaying ? 'playing' : '') + '" data-action="play" data-index="' + idx + '" title="Preview">';
        html +=      isPlaying ? '⏸' : '▶';
        html += '  </button>';
        html += '  <div class="sfx-info">';
        html += '    <span class="sfx-name" title="' + escapeHtml(item.path) + '">' + escapeHtml(item.name) + '</span>';
        html += '    <span class="sfx-meta">' + durStr + '</span>';
        html += '  </div>';
        html += '  <select class="sfx-tag-select" data-action="tag" data-index="' + idx + '">';
        TAG_OPTIONS.forEach(function(opt) {
            var sel = (item.tag === opt) ? 'selected' : '';
            html += '<option value="' + escapeHtml(opt) + '" ' + sel + '>' + escapeHtml(opt.toUpperCase()) + '</option>';
        });
        html += '  </select>';
        html += '  <div class="sfx-actions">';
        html += '    <button class="sfx-icon-btn btn-edit-sfx" data-action="edit" data-index="' + idx + '" title="Edit & Trim Waveform">✏️</button>';
        html += '    <button class="sfx-icon-btn btn-delete btn-delete-sfx" data-action="delete" data-index="' + idx + '" title="Remove">✕</button>';
        html += '  </div>';
        html += '</div>';
    });

    container.innerHTML = html;
}

function playSfxPreview(index) {
    var item = sfxLibrary[index];
    if (!item) return;

    if (activePlayingId === item.id && activeAudio) {
        activeAudio.pause();
        activeAudio = null;
        activePlayingId = null;
        renderSfxLibrary();
        return;
    }

    if (activeAudio) {
        activeAudio.pause();
        activeAudio = null;
    }

    try {
        var cleanPath = item.path.replace(/\\/g, "/");
        if (cleanPath.indexOf(":") === 1) cleanPath = "/" + cleanPath;
        var audioUrl = "file://" + cleanPath;

        activeAudio = new Audio(audioUrl);
        activePlayingId = item.id;
        renderSfxLibrary();

        activeAudio.onended = function() {
            activeAudio = null;
            activePlayingId = null;
            renderSfxLibrary();
        };
        activeAudio.onerror = function() {
            logSFX("Could not preview audio file: " + item.path);
            activeAudio = null;
            activePlayingId = null;
            renderSfxLibrary();
        };
        activeAudio.play();
    } catch(e) {
        logSFX("Playback error: " + e.message);
    }
}

// Waveform Trimmer Modal
function openTrimmerModal(item) {
    activeTrimmerItem = item;
    var modal = document.getElementById("trimmerModal");
    var title = document.getElementById("trimmerFileName");
    if (title) title.innerText = "Trim: " + item.name;

    modal.classList.remove("hidden");
    logSFX("Opening waveform trimmer for " + item.name);

    // Read audio buffer
    try {
        var ctx = getAudioContext();
        var fs = (typeof window !== "undefined" && window.require) ? window.require("fs") : null;
        if (fs && fs.existsSync(item.path)) {
            var buf = fs.readFileSync(item.path);
            ctx.decodeAudioData(buf.buffer, function(decoded) {
                trimmerAudioBuffer = decoded;
                trimmerDuration = decoded.duration;
                trimmerInSec = 0;
                trimmerOutSec = decoded.duration;
                updateTrimHandlePositions();
                drawWaveform();
            }, function(err) {
                logSFX("Decode error: " + err);
            });
        } else {
            // Fallback: draw placeholder waveform
            trimmerDuration = item.duration || 2.0;
            trimmerInSec = 0;
            trimmerOutSec = trimmerDuration;
            updateTrimHandlePositions();
            drawPlaceholderWaveform();
        }
    } catch(e) {
        logSFX("Waveform load note: " + e.message);
    }
}

function closeTrimmerModal() {
    var modal = document.getElementById("trimmerModal");
    if (modal) modal.classList.add("hidden");
    if (activeSourceNode) {
        try { activeSourceNode.stop(); } catch(e) {}
        activeSourceNode = null;
    }
    activeTrimmerItem = null;
}

function updateTrimHandlePositions() {
    var overlay = document.getElementById("trimHandlesOverlay");
    if (!overlay || trimmerDuration <= 0) return;

    var width = overlay.clientWidth || 560;
    var leftPx = (trimmerInSec / trimmerDuration) * width;
    var rightPx = (trimmerOutSec / trimmerDuration) * width;

    var handleIn = document.getElementById("handleIn");
    var handleOut = document.getElementById("handleOut");
    var trimRegion = document.getElementById("trimRegion");

    if (handleIn) handleIn.style.left = Math.max(0, leftPx - 5) + "px";
    if (handleOut) handleOut.style.left = Math.max(0, rightPx - 5) + "px";
    if (trimRegion) {
        trimRegion.style.left = leftPx + "px";
        trimRegion.style.width = Math.max(0, rightPx - leftPx) + "px";
    }

    var lblIn = document.getElementById("lblTrimIn");
    var lblOut = document.getElementById("lblTrimOut");
    var lblDur = document.getElementById("lblTrimDur");
    if (lblIn) lblIn.innerText = trimmerInSec.toFixed(2) + "s";
    if (lblOut) lblOut.innerText = trimmerOutSec.toFixed(2) + "s";
    if (lblDur) lblDur.innerText = (trimmerOutSec - trimmerInSec).toFixed(2) + "s";
}

function drawWaveform() {
    var canvas = document.getElementById("trimmerCanvas");
    if (!canvas || !trimmerAudioBuffer) return;
    var ctx = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    var rawData = trimmerAudioBuffer.getChannelData(0);
    var step = Math.ceil(rawData.length / width);
    var amp = height / 2;

    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, amp);

    for (var i = 0; i < width; i++) {
        var min = 1.0;
        var max = -1.0;
        for (var j = 0; j < step; j++) {
            var datum = rawData[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        ctx.lineTo(i, (1 + min) * amp);
        ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();
}

function drawPlaceholderWaveform() {
    var canvas = document.getElementById("trimmerCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#111420";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#ff5c38";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i < width; i += 4) {
        var h = (Math.sin(i * 0.08) * 0.5 + 0.5) * (height * 0.7);
        ctx.moveTo(i, (height - h) / 2);
        ctx.lineTo(i, (height + h) / 2);
    }
    ctx.stroke();
}

function playTrimmedAudition() {
    if (!trimmerAudioBuffer) return;
    if (activeSourceNode) {
        try { activeSourceNode.stop(); } catch(e) {}
        activeSourceNode = null;
    }
    var ctx = getAudioContext();
    activeSourceNode = ctx.createBufferSource();
    activeSourceNode.buffer = trimmerAudioBuffer;
    activeSourceNode.connect(ctx.destination);
    var dur = Math.max(0.05, trimmerOutSec - trimmerInSec);
    activeSourceNode.start(0, trimmerInSec, dur);
}

function saveTrimAndReplace() {
    if (!activeTrimmerItem) return;
    var item = activeTrimmerItem;
    var inSec = trimmerInSec;
    var outSec = trimmerOutSec;
    logSFX("Rendering trim [" + inSec.toFixed(2) + "s - " + outSec.toFixed(2) + "s] for " + item.name + "...");

    var runId = Date.now();
    hostCall("getRuntimeFolder", undefined, function(runtimeFolder) {
        if (!runtimeFolder || runtimeFolder.indexOf("ERR") === 0) {
            logSFX("Could not access runtime folder.");
            return;
        }
        var reqPath = runtimeFolder + "\\trim_request_" + runId + ".json";
        var outPath = runtimeFolder + "\\trim_out_" + runId + ".json";
        var logPath = runtimeFolder + "\\trim_log_" + runId + ".log";
        var reqData = {
            mode: "slice_sfx",
            filePath: item.path,
            inSec: inSec,
            outSec: outSec
        };

        hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(reqData) }), function(writeRes) {
            if (writeRes !== "OK") { logSFX("Error writing slice request: " + writeRes); return; }
            var python = "C:\\Program Files\\Python313\\python.exe";
            var script = EXTENSION_ROOT + "\\ai_processor.py";

            hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:reqPath, output:outPath, logPath:logPath }), function(batchRes) {
                var poller = setInterval(function() {
                    hostCall("readTextFile", outPath, function(content) {
                        if (content && content.indexOf("success") !== -1) {
                            clearInterval(poller);
                            try {
                                var res = JSON.parse(content);
                                if (res.success) {
                                    item.duration = res.newDuration;
                                    logSFX("Successfully trimmed and replaced " + item.name + " (" + res.newDuration + "s). Backup saved.");
                                    saveSfxState();
                                    renderSfxLibrary();
                                    closeTrimmerModal();
                                } else {
                                    logSFX("Trim failed: " + res.error);
                                }
                            } catch(err) {
                                logSFX("Error parsing trim response: " + err.message);
                            }
                        }
                    });
                }, 500);

                setTimeout(function() { clearInterval(poller); }, 15000);
            }, 10000);
        });
    });
}

// Running SFX Placement
function startSfxRun() {
    saveSfxState();
    logSFX("Scanning timeline sequence for dialogue punchlines...");
    if (typeof showProcessOverlay === "function") showProcessOverlay("sfx");

    hostCall("getHostStatus", undefined, function(statusRaw) {
        var status;
        try {
            status = JSON.parse(statusRaw);
        } catch(e) {
            logSFX("Timeline status note: " + (statusRaw || "Please keep active sequence open."));
            return;
        }
        if (status && status.error) {
            logSFX("Timeline note: " + status.error);
            finishProcessOverlay(false, status.error);
            return;
        }
        if (!status || !status.sequenceName) {
            logSFX("No active sequence found. Please click inside your Premiere timeline to activate it.");
            finishProcessOverlay(false, "no active sequence found.");
            return;
        }

        advanceProcessStep(1);
        hostCall("getTimelineAudioClips", JSON.stringify(appConfig), function(rawTimeline) {
            var timeline;
            try {
                timeline = JSON.parse(rawTimeline);
                if (!timeline.clips || !timeline.clips.length) throw new Error("No dialogue clips found on timeline.");
            } catch(e) {
                logSFX("Timeline read note: " + e.message);
                finishProcessOverlay(false, e.message);
                return;
            }
            advanceProcessStep(2);

            var runId = Date.now();
            hostCall("getRuntimeFolder", undefined, function(runtimeFolder) {
                if (!runtimeFolder || runtimeFolder.indexOf("ERR") === 0) { logSFX("Could not access runtime folder."); return; }
                var reqPath = runtimeFolder + "\\sfx_request_" + runId + ".json";
                var outPath = runtimeFolder + "\\sfx_output_" + runId + ".json";
                var logPath = runtimeFolder + "\\sfx_debug_" + runId + ".log";
                var progPath = runtimeFolder + "\\sfx_prog_" + runId + ".json";

                var request = {
                    mode: "sfx",
                    clips: timeline.clips,
                    sfxLibrary: sfxLibrary,
                    populationRate: sfxConfig.populationRate,
                    targetTrack: sfxConfig.targetTrack,
                    volumeDb: sfxConfig.volumeDb,
                    snapToCut: sfxConfig.snapToCut,
                    flagLoudRed: sfxConfig.flagLoudRed,
                    progressPath: progPath
                };

                hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(request) }), function(writeRes) {
                    if (writeRes !== "OK") { logSFX("Error writing SFX request."); return; }
                    var python = "C:\\Program Files\\Python313\\python.exe";
                    var script = EXTENSION_ROOT + "\\ai_processor.py";

                    logSFX("AI reasoning started... Predicting punchline timestamps.");
                    advanceProcessStep(2);
                    hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:reqPath, output:outPath, logPath:logPath }), function(bRes) {
                        advanceProcessStep(3);
                        var pollTimer = setInterval(function() {
                            hostCall("readTextFile", outPath, function(outContent) {
                                if (outContent && outContent.indexOf("success") !== -1) {
                                    clearInterval(pollTimer);
                                    try {
                                        var output = JSON.parse(outContent);
                                        if (output.success && output.sfxOps) {
                                            advanceProcessStep(4);
                                            logSFX("AI identified " + output.sfxOps.length + " punchline moments. Placing onto Track A" + sfxConfig.targetTrack + "...");
                                            advanceProcessStep(5);
                                            hostCall("placeSoundEffectsOnTimeline", JSON.stringify(output), function(placeResultRaw) {
                                                try {
                                                    var pRes = JSON.parse(placeResultRaw);
                                                    var msg = "Done! Placed " + pRes.placedCount + " sound effect(s) on Track A" + sfxConfig.targetTrack + ".";
                                                    if (pRes.redLabeledCount) msg += " (" + pRes.redLabeledCount + " loud outliers flagged RED).";
                                                    logSFX(msg);
                                                    finishProcessOverlay(true, msg);
                                                } catch(pe) {
                                                    logSFX("Placed SFX on timeline.");
                                                    finishProcessOverlay(true, "placed sound effects.");
                                                }
                                            }, 40000);
                                        } else {
                                            var errMsg = "SFX prediction completed: " + (output.error || "0 events");
                                            logSFX(errMsg);
                                            finishProcessOverlay(false, output.error || "0 punchlines found on this timeline.");
                                        }
                                    } catch(err) {
                                        logSFX("Error parsing SFX output: " + err.message);
                                        finishProcessOverlay(false, "error parsing sfx output: " + err.message);
                                    }
                                }
                            });
                        }, 800);

                        setTimeout(function() { clearInterval(pollTimer); }, 120000);
                    }, 10000);
                });
            });
        }, 30000);
    });
}

// ============================================================
// AUTOPOV CONTROLLER
// ============================================================

var povState = {
    scope: "entire",
    audioTracks: [],
    videoTracks: [],
    selectedTrackIndices: [],
    inPoint: 0.0,
    outPoint: 0.0,
    hasInOut: false,
    sequenceName: "",
    fps: 30.0,
    speakers: [],
    povs: [],
    running: false
};

function logPOV(msg) {
    var el = document.getElementById("consoleLogPOV");
    if (!el) return;
    var time = new Date().toLocaleTimeString().toLowerCase();
    el.innerHTML += "<div><span style='color:#71717a;'>[" + time + "]</span> " + msg + "</div>";
    el.scrollTop = el.scrollHeight;
}

function loadPOVSequenceTracks() {
    hostCall("autoCutGetSequenceTracks", undefined, function(raw) {
        var res;
        try { res = JSON.parse(raw); } catch(e) {}
        if (!res || !res.success) {
            logPOV("could not inspect sequence tracks: " + (res ? res.error : raw));
            return;
        }

        povState.audioTracks = res.audioTracks || [];
        povState.videoTracks = res.videoTracks || [];
        povState.inPoint = res.inPoint || 0.0;
        povState.outPoint = res.outPoint || 0.0;
        povState.hasInOut = res.hasInOut || false;
        povState.sequenceName = res.sequenceName || "";
        povState.fps = 30.0;

        updatePOVDurationLabel();
        renderPOVTrackList();
        logPOV("detected " + povState.audioTracks.length + " audio track(s) and " + povState.videoTracks.length + " video track(s) in sequence: " + povState.sequenceName + ".");
    });
}

function updatePOVDurationLabel() {
    var lbl = document.getElementById("lblPOVDuration");
    if (!lbl) return;
    var startStr = (povState.scope === "inout" && povState.hasInOut) ? formatTimecodeSeconds(povState.inPoint) : "00:00:00";
    var endStr = (povState.scope === "inout" && povState.hasInOut) ? formatTimecodeSeconds(povState.outPoint) : "00:00:00";
    lbl.textContent = startStr + " - " + endStr;
}

function renderPOVTrackList() {
    var container = document.getElementById("povTrackList");
    if (!container) return;
    if (povState.audioTracks.length === 0) {
        container.innerHTML = '<div style="color:#71717a; font-size:11px; text-align:center; padding:10px;">no audio tracks found in sequence.</div>';
        return;
    }

    container.innerHTML = "";
    povState.selectedTrackIndices = [];

    povState.audioTracks.forEach(function(trk) {
        var isChecked = !trk.isMuted && trk.clipCount > 0;
        if (isChecked) povState.selectedTrackIndices.push(trk.index);

        var row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.02);";
        row.dataset.trackIndex = trk.index;

        var left = document.createElement("label");
        left.style.cssText = "display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;";

        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = isChecked;
        cb.style.accentColor = "#8fbc8f";
        cb.addEventListener("change", updatePOVSelectedTracks);

        var nameSpan = document.createElement("span");
        nameSpan.style.fontWeight = "bold";
        nameSpan.textContent = trk.name.toLowerCase();

        var countSpan = document.createElement("span");
        countSpan.style.cssText = "color: #71717a; font-size: 10px;";
        countSpan.textContent = "(" + trk.clipCount + " clips)";

        left.appendChild(cb);
        left.appendChild(nameSpan);
        left.appendChild(countSpan);
        row.appendChild(left);
        container.appendChild(row);
    });
}

function updatePOVSelectedTracks() {
    povState.selectedTrackIndices = [];
    var container = document.getElementById("povTrackList");
    if (!container) return;
    var rows = container.children;
    for (var i = 0; i < rows.length; i++) {
        var cb = rows[i].querySelector("input[type='checkbox']");
        var tIdx = parseInt(rows[i].dataset.trackIndex, 10);
        if (cb && cb.checked) povState.selectedTrackIndices.push(tIdx);
    }
}

function setPOVScope(scope) {
    povState.scope = scope;
    var btnEntire = document.getElementById("btnPOVScopeEntire");
    var btnInOut = document.getElementById("btnPOVScopeInOut");
    if (scope === "entire") {
        if (btnEntire) { btnEntire.classList.add("active"); btnEntire.style.borderColor = "#8fbc8f"; btnEntire.style.background = "rgba(143, 188, 143, 0.12)"; btnEntire.style.color = "#f4f4f5"; }
        if (btnInOut) { btnInOut.classList.remove("active"); btnInOut.style.borderColor = "#27272a"; btnInOut.style.background = "#18181b"; btnInOut.style.color = "#a1a1aa"; }
    } else {
        if (btnInOut) { btnInOut.classList.add("active"); btnInOut.style.borderColor = "#8fbc8f"; btnInOut.style.background = "rgba(143, 188, 143, 0.12)"; btnInOut.style.color = "#f4f4f5"; }
        if (btnEntire) { btnEntire.classList.remove("active"); btnEntire.style.borderColor = "#27272a"; btnEntire.style.background = "#18181b"; btnEntire.style.color = "#a1a1aa"; }
    }
    updatePOVDurationLabel();
}

function goToPOVStep(step) {
    var step1 = document.getElementById("povStep1");
    var step2 = document.getElementById("povStep2");
    var pill1 = document.getElementById("povStepPillSections");
    var pill2 = document.getElementById("povStepPillSpeakers");

    if (step === 2) {
        updatePOVSelectedTracks();
        if (povState.selectedTrackIndices.length === 0) {
            logPOV("please select at least one audio track to continue.");
            return;
        }
        if (step1) step1.style.display = "none";
        if (step2) step2.style.display = "block";
        if (pill1) { pill1.style.background = "#27272a"; pill1.style.color = "#a1a1aa"; pill1.innerHTML = '<span style="color:#8fbc8f; font-weight:bold;">✓</span> <span>sections</span>'; }
        if (pill2) { pill2.style.background = "#8fbc8f"; pill2.style.color = "#18181b"; pill2.innerHTML = '<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:rgba(0,0,0,0.25); font-size:10px; font-weight:bold;">2</span> <span>speakers &amp; povs</span>'; }
        if (povState.speakers.length === 0) initPOVDefaults();
        renderPOVSpeakers();
        renderPOVPovs();
    } else {
        if (step1) step1.style.display = "block";
        if (step2) step2.style.display = "none";
        if (pill1) { pill1.style.background = "#8fbc8f"; pill1.style.color = "#18181b"; pill1.innerHTML = '<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:rgba(0,0,0,0.25); font-size:10px; font-weight:bold;">1</span> <span>sections</span>'; }
        if (pill2) { pill2.style.background = "#27272a"; pill2.style.color = "#a1a1aa"; pill2.innerHTML = '<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:rgba(255,255,255,0.1); font-size:10px; font-weight:bold;">2</span> <span>speakers &amp; povs</span>'; }
    }
}

function initPOVDefaults() {
    povState.speakers = [];
    povState.povs = [];
    povState.selectedTrackIndices.forEach(function(tIdx, i) {
        var trk = povState.audioTracks.filter(function(t) { return t.index === tIdx; })[0];
        povState.speakers.push({ name: trk ? trk.name : ("speaker a" + (tIdx + 1)), trackIndex: tIdx, priority: 50 });
        if (i < povState.videoTracks.length) {
            povState.povs.push({ videoTrack: povState.videoTracks[i].index, speakers: [tIdx] });
        }
    });
    if (povState.povs.length === 0 && povState.videoTracks.length > 0) {
        povState.povs.push({ videoTrack: povState.videoTracks[0].index, speakers: povState.selectedTrackIndices.slice(0, 1) });
    }
}

function renderPOVSpeakers() {
    var container = document.getElementById("povSpeakersList");
    if (!container) return;
    container.innerHTML = "";

    povState.speakers.forEach(function(sp, idx) {
        var row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; background: #18181b; border: 1px solid #27272a;";

        var nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = sp.name;
        nameInput.placeholder = "speaker name";
        nameInput.style.cssText = "flex: 1; background: #09090b; border: 1px solid #27272a; border-radius: 4px; padding: 5px 8px; color: #f4f4f5; font-size: 12px;";
        nameInput.addEventListener("change", function() { povState.speakers[idx].name = nameInput.value; });

        var trackSel = document.createElement("select");
        trackSel.style.cssText = "background: #09090b; border: 1px solid #27272a; border-radius: 4px; padding: 5px 8px; color: #f4f4f5; font-size: 12px;";
        povState.audioTracks.forEach(function(trk) {
            var opt = document.createElement("option");
            opt.value = trk.index;
            opt.textContent = trk.name.toLowerCase() + " (" + trk.clipCount + ")";
            if (trk.index === sp.trackIndex) opt.selected = true;
            trackSel.appendChild(opt);
        });
        trackSel.addEventListener("change", function() { povState.speakers[idx].trackIndex = parseInt(trackSel.value, 10); });

        var priLabel = document.createElement("span");
        priLabel.style.cssText = "font-size: 10px; color: #71717a; min-width: 28px;";
        priLabel.textContent = "pri " + sp.priority;

        var priRange = document.createElement("input");
        priRange.type = "range";
        priRange.min = "1"; priRange.max = "100"; priRange.value = sp.priority;
        priRange.style.cssText = "width: 80px; accent-color: #8fbc8f; cursor: pointer;";
        priRange.addEventListener("input", function() {
            povState.speakers[idx].priority = parseInt(priRange.value, 10);
            priLabel.textContent = "pri " + povState.speakers[idx].priority;
        });

        var removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.style.cssText = "background: none; border: none; color: #a1a1aa; cursor: pointer; font-size: 12px; padding: 4px;";
        removeBtn.addEventListener("click", function() {
            povState.speakers.splice(idx, 1);
            renderPOVSpeakers();
        });

        row.appendChild(nameInput);
        row.appendChild(trackSel);
        row.appendChild(priRange);
        row.appendChild(priLabel);
        row.appendChild(removeBtn);
        container.appendChild(row);
    });
}

function renderPOVPovs() {
    var container = document.getElementById("povPovsList");
    if (!container) return;
    container.innerHTML = "";

    povState.povs.forEach(function(pov, idx) {
        var row = document.createElement("div");
        row.style.cssText = "display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 8px; background: #18181b; border: 1px solid #27272a;";

        var topRow = document.createElement("div");
        topRow.style.cssText = "display: flex; align-items: center; gap: 8px;";

        var vtLabel = document.createElement("span");
        vtLabel.style.cssText = "font-size: 11px; color: #a1a1aa; font-weight: bold; min-width: 30px;";
        vtLabel.textContent = "pov " + (idx + 1);

        var vtSelect = document.createElement("select");
        vtSelect.style.cssText = "flex: 1; background: #09090b; border: 1px solid #27272a; border-radius: 4px; padding: 5px 8px; color: #f4f4f5; font-size: 12px;";
        povState.videoTracks.forEach(function(vt) {
            var opt = document.createElement("option");
            opt.value = vt.index;
            opt.textContent = vt.name.toLowerCase() + " (" + vt.clipCount + " clips)";
            if (vt.index === pov.videoTrack) opt.selected = true;
            vtSelect.appendChild(opt);
        });
        vtSelect.addEventListener("change", function() { povState.povs[idx].videoTrack = parseInt(vtSelect.value, 10); });

        var removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.style.cssText = "background: none; border: none; color: #a1a1aa; cursor: pointer; font-size: 12px; padding: 4px;";
        removeBtn.addEventListener("click", function() {
            povState.povs.splice(idx, 1);
            renderPOVPovs();
        });

        topRow.appendChild(vtLabel);
        topRow.appendChild(vtSelect);
        topRow.appendChild(removeBtn);

        var spkRow = document.createElement("div");
        spkRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px; padding-left: 38px;";

        if (povState.speakers.length === 0) {
            var note = document.createElement("span");
            note.style.cssText = "color: #71717a; font-size: 11px;";
            note.textContent = "add speakers first (step 2 above).";
            spkRow.appendChild(note);
        } else {
            povState.speakers.forEach(function(sp) {
                var chip = document.createElement("label");
                chip.style.cssText = "display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; padding: 3px 8px; border-radius: 4px; " +
                    (pov.speakers.indexOf(sp.trackIndex) !== -1 ? "background: rgba(143,188,143,0.18); border: 1px solid #8fbc8f; color: #f4f4f5;" : "background: #09090b; border: 1px solid #27272a; color: #a1a1aa;");

                var cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = pov.speakers.indexOf(sp.trackIndex) !== -1;
                cb.style.accentColor = "#8fbc8f";
                cb.addEventListener("change", function() {
                    var arr = povState.povs[idx].speakers;
                    if (cb.checked) {
                        if (arr.indexOf(sp.trackIndex) === -1) arr.push(sp.trackIndex);
                    } else {
                        var i2 = arr.indexOf(sp.trackIndex);
                        if (i2 !== -1) arr.splice(i2, 1);
                    }
                    renderPOVPovs();
                });

                chip.appendChild(cb);
                chip.appendChild(document.createTextNode(sp.name));
                spkRow.appendChild(chip);
            });
        }

        row.appendChild(topRow);
        row.appendChild(spkRow);
        container.appendChild(row);
    });
}

function addPOVSpeaker() {
    var usedTracks = povState.speakers.map(function(s) { return s.trackIndex; });
    var available = povState.audioTracks.filter(function(t) { return usedTracks.indexOf(t.index) === -1; });
    var trackIdx = available.length > 0 ? available[0].index : (povState.audioTracks.length > 0 ? povState.audioTracks[0].index : 0);
    povState.speakers.push({ name: "speaker " + (povState.speakers.length + 1), trackIndex: trackIdx, priority: 50 });
    renderPOVSpeakers();
}

function addPOVPov() {
    if (povState.videoTracks.length === 0) { logPOV("no video tracks in this sequence."); return; }
    var usedVt = povState.povs.map(function(p) { return p.videoTrack; });
    var availableVt = povState.videoTracks.filter(function(v) { return usedVt.indexOf(v.index) === -1; });
    var vtIdx = availableVt.length > 0 ? availableVt[0].index : povState.videoTracks[0].index;
    povState.povs.push({ videoTrack: vtIdx, speakers: [] });
    renderPOVPovs();
}

function executeAutoPOV() {
    if (povState.running) return;
    updatePOVSelectedTracks();

    if (povState.speakers.length === 0) { logPOV("add at least one speaker first."); return; }
    if (povState.povs.length === 0) { logPOV("add at least one pov first."); return; }

    var hasAssigned = false;
    for (var p = 0; p < povState.povs.length; p++) {
        if (povState.povs[p].speakers.length > 0) { hasAssigned = true; break; }
    }
    if (!hasAssigned) { logPOV("assign at least one speaker to a pov."); return; }

    var radUnused = document.querySelector("input[name='radPOVUnused']:checked");
    var unusedMode = radUnused ? radUnused.value : "disable";
    var thrEl = document.getElementById("numPOVThreshold");
    var threshold = thrEl ? parseFloat(thrEl.value) : -38.0;
    var msEl = document.getElementById("numPOVMinShotMs");
    var minShotMs = msEl ? parseFloat(msEl.value) : 500.0;

    povState.running = true;
    var btn = document.getElementById("btnPOVExecute");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ working..."; }
    function resetBtn() { povState.running = false; if (btn) { btn.disabled = false; btn.textContent = "start pov editing"; } }

    logPOV("[1/3] reading speaker audio clips from disk (no render needed)...");
    if (typeof showProcessOverlay === "function") showProcessOverlay("pov");

    var speakerTrackList = povState.speakers.map(function(s) { return s.trackIndex; });
    var clipParams = { trackIndices: speakerTrackList, scope: povState.scope };

    hostCall("autoCutGetTrackClipsForSilence", JSON.stringify(clipParams), function(rawClips) {
        var clipsRes;
        try { clipsRes = JSON.parse(rawClips); } catch(e) {}
        if (!clipsRes || !clipsRes.success || !clipsRes.clips || !clipsRes.clips.length) {
            logPOV("could not read timeline clips: " + (clipsRes ? clipsRes.error : rawClips));
            finishProcessOverlay(false, "could not read timeline clips.");
            resetBtn();
            return;
        }

        advanceProcessStep(1);
        logPOV("[2/3] detecting who is speaking and when (threshold: " + threshold + "db)...");

        var reqData = {
            mode: "analyze_pov_turns",
            clips: clipsRes.clips,
            speakers: povState.speakers,
            threshold: threshold,
            minShotMs: minShotMs,
            bridgeGapMs: 350.0,
            scope: povState.scope,
            seqInPoint: clipsRes.inPoint,
            seqOutPoint: clipsRes.outPoint
        };

        runSilenceAnalysisJob(reqData, function(anaRes) {
            if (!anaRes || !anaRes.success) {
                logPOV("analysis failed: " + (anaRes ? anaRes.error : "unknown"));
                finishProcessOverlay(false, anaRes ? anaRes.error : "analysis failed.");
                resetBtn();
                return;
            }

            var segments = anaRes.segments || [];
            if (segments.length === 0) {
                logPOV("no speaker turns detected. check threshold or track selection.");
                finishProcessOverlay(false, "no speaker turns detected.");
                resetBtn();
                return;
            }

            advanceProcessStep(2);
            logPOV("[3/3] executing pov switching (" + segments.length + " turns, " + anaRes.totalDuration + "s timeline)...");

            var plan = {
                segments: segments,
                povs: povState.povs,
                unusedMode: unusedMode,
                targetSequenceName: clipsRes.sequenceName,
                fps: clipsRes.fps || 30.0
            };

            advanceProcessStep(3);
            hostCall("povExecuteSwitch", JSON.stringify(plan), function(cutResRaw) {
                advanceProcessStep(4);
                resetBtn();
                var cutRes;
                try { cutRes = JSON.parse(cutResRaw); } catch(e) {}
                if (cutRes && cutRes.success) {
                    logPOV(cutRes.message);
                    finishProcessOverlay(true, cutRes.message);
                } else {
                    logPOV("pov error: " + (cutRes ? cutRes.error : cutResRaw));
                    finishProcessOverlay(false, cutRes ? cutRes.error : "pov switching failed.");
                }
            }, 900000);
        }, "pov analysis");
    }, 900000);
}

// ============================================================
// AUTOCUT SILENCES CONTROLLER
// ============================================================

var silencesState = {
    scope: "entire",
    sequenceTracks: [],
    selectedTrackIndices: [],
    sequenceDuration: 0.0,
    inPoint: 0.0,
    outPoint: 0.0,
    hasInOut: false,
    threshold: -38.0,
    preset: "paced",
    minSilenceMs: 150,
    minTalkMs: 100,
    marginBeforeMs: 100,
    marginAfterMs: 100,
    management: "remove",
    transition: "none",
    analysisResult: null
};

function logSilences(msg) {
    var el = document.getElementById("consoleLogSilences");
    if (!el) return;
    var time = new Date().toLocaleTimeString().toLowerCase();
    el.innerHTML += "<div><span style='color:#71717a;'>[" + time + "]</span> " + msg + "</div>";
    el.scrollTop = el.scrollHeight;
}

function formatTimecodeSeconds(totalSec) {
    if (isNaN(totalSec) || totalSec < 0) totalSec = 0;
    var hrs = Math.floor(totalSec / 3600);
    var mins = Math.floor((totalSec % 3600) / 60);
    var secs = Math.floor(totalSec % 60);
    var pad = function(n) { return (n < 10 ? "0" : "") + n; };
    return pad(hrs) + ":" + pad(mins) + ":" + pad(secs);
}

function loadSilencesSequenceTracks() {
    hostCall("autoCutGetSequenceTracks", undefined, function(raw) {
        var res;
        try { res = JSON.parse(raw); } catch(e) {}
        if (!res || !res.success) {
            logSilences("could not inspect sequence tracks: " + (res ? res.error : raw));
            return;
        }

        silencesState.sequenceTracks = res.audioTracks || [];
        silencesState.sequenceDuration = res.duration || 0.0;
        silencesState.sequenceName = res.sequenceName || "";
        silencesState.inPoint = res.inPoint || 0.0;
        silencesState.outPoint = res.outPoint || 0.0;
        silencesState.hasInOut = res.hasInOut || false;

        var lblDur = document.getElementById("lblSilencesDuration");
        if (lblDur) {
            var startStr = (silencesState.scope === "inout" && silencesState.hasInOut) ? formatTimecodeSeconds(silencesState.inPoint) : "00:00:00";
            var endStr = (silencesState.scope === "inout" && silencesState.hasInOut) ? formatTimecodeSeconds(silencesState.outPoint) : formatTimecodeSeconds(silencesState.sequenceDuration);
            lblDur.textContent = startStr + " - " + endStr;
        }

        var container = document.getElementById("silencesTrackList");
        if (!container) return;

        if (silencesState.sequenceTracks.length === 0) {
            container.innerHTML = '<div style="color:#71717a; font-size:11px; text-align:center; padding:10px;">no audio tracks found in sequence.</div>';
            return;
        }

        container.innerHTML = "";
        silencesState.selectedTrackIndices = [];

        silencesState.sequenceTracks.forEach(function(trk) {
            var isChecked = !trk.isMuted && trk.clipCount > 0;
            if (isChecked) silencesState.selectedTrackIndices.push(trk.index);

            var row = document.createElement("div");
            row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.02);";

            var left = document.createElement("label");
            left.style.cssText = "display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;";

            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = isChecked;
            cb.style.accentColor = "#8fbc8f";
            cb.addEventListener("change", function() {
                updateSelectedSilencesTracks();
            });

            var nameSpan = document.createElement("span");
            nameSpan.style.fontWeight = "bold";
            nameSpan.textContent = trk.name.toLowerCase();

            var countSpan = document.createElement("span");
            countSpan.style.cssText = "color: #71717a; font-size: 10px;";
            countSpan.textContent = "(" + trk.clipCount + " clips)";

            left.appendChild(cb);
            left.appendChild(nameSpan);
            left.appendChild(countSpan);

            var right = document.createElement("div");
            right.style.cssText = "display: flex; align-items: center; gap: 2px;";
            for (var b = 0; b < 16; b++) {
                var bar = document.createElement("span");
                var h = (trk.clipCount > 0) ? (4 + Math.sin(b * 0.6 + trk.index) * 5 + 4) : 2;
                bar.style.cssText = "display: inline-block; width: 2px; height: " + Math.max(2, h) + "px; background: " + (isChecked ? "#8fbc8f" : "#3f3f46") + "; border-radius: 1px;";
                right.appendChild(bar);
            }

            row.appendChild(left);
            row.appendChild(right);
            row.dataset.trackIndex = trk.index;
            container.appendChild(row);
        });

        logSilences("detected " + silencesState.sequenceTracks.length + " audio tracks in sequence: " + res.sequenceName + " (" + silencesState.sequenceDuration.toFixed(1) + "s).");
        if (res.cmdDiag) logSilences("command diagnostics: " + JSON.stringify(res.cmdDiag));
    });
}

function updateSelectedSilencesTracks() {
    silencesState.selectedTrackIndices = [];
    var container = document.getElementById("silencesTrackList");
    if (!container) return;
    var rows = container.children;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var cb = row.querySelector("input[type='checkbox']");
        var tIdx = parseInt(row.dataset.trackIndex, 10);
        if (cb && cb.checked) {
            silencesState.selectedTrackIndices.push(tIdx);
        }
        var bars = row.querySelectorAll("span span");
        bars.forEach(function(b) {
            b.style.background = (cb && cb.checked) ? "#8fbc8f" : "#3f3f46";
        });
    }
}

function setSilencesScope(scope) {
    silencesState.scope = scope;
    var btnEntire = document.getElementById("btnSilencesScopeEntire");
    var btnInOut = document.getElementById("btnSilencesScopeInOut");
    if (scope === "entire") {
        if (btnEntire) {
            btnEntire.classList.add("active");
            btnEntire.style.borderColor = "#8fbc8f";
            btnEntire.style.background = "rgba(143, 188, 143, 0.12)";
            btnEntire.style.color = "#f4f4f5";
        }
        if (btnInOut) {
            btnInOut.classList.remove("active");
            btnInOut.style.borderColor = "#27272a";
            btnInOut.style.background = "#18181b";
            btnInOut.style.color = "#a1a1aa";
        }
    } else {
        if (btnInOut) {
            btnInOut.classList.add("active");
            btnInOut.style.borderColor = "#8fbc8f";
            btnInOut.style.background = "rgba(143, 188, 143, 0.12)";
            btnInOut.style.color = "#f4f4f5";
        }
        if (btnEntire) {
            btnEntire.classList.remove("active");
            btnEntire.style.borderColor = "#27272a";
            btnEntire.style.background = "#18181b";
            btnEntire.style.color = "#a1a1aa";
        }
    }

    var lblDur = document.getElementById("lblSilencesDuration");
    if (lblDur) {
        var startStr = (scope === "inout" && silencesState.hasInOut) ? formatTimecodeSeconds(silencesState.inPoint) : "00:00:00";
        var endStr = (scope === "inout" && silencesState.hasInOut) ? formatTimecodeSeconds(silencesState.outPoint) : formatTimecodeSeconds(silencesState.sequenceDuration);
        lblDur.textContent = startStr + " - " + endStr;
    }
}

function goToSilencesStep(step) {
    var step1 = document.getElementById("silencesStep1");
    var step2 = document.getElementById("silencesStep2");
    var pill1 = document.getElementById("stepPillSections");
    var pill2 = document.getElementById("stepPillSettings");

    if (step === 2) {
        updateSelectedSilencesTracks();
        if (silencesState.selectedTrackIndices.length === 0) {
            logSilences("please select at least one audio track to analyze.");
            return;
        }
        if (step1) step1.style.display = "none";
        if (step2) step2.style.display = "block";
        if (pill1) {
            pill1.style.background = "#27272a";
            pill1.style.color = "#a1a1aa";
            pill1.innerHTML = '<span style="color:#8fbc8f; font-weight:bold;">✓</span> <span>sections</span>';
        }
        if (pill2) {
            pill2.style.background = "#8fbc8f";
            pill2.style.color = "#fff";
            pill2.innerHTML = '<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:rgba(0,0,0,0.25); font-size:10px; font-weight:bold;">2</span> <span>settings</span>';
        }
        drawInitialWaveformPlaceholder();
    } else {
        if (step1) step1.style.display = "block";
        if (step2) step2.style.display = "none";
        if (pill1) {
            pill1.style.background = "#8fbc8f";
            pill1.style.color = "#fff";
            pill1.innerHTML = '<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:rgba(0,0,0,0.25); font-size:10px; font-weight:bold;">1</span> <span>sections</span>';
        }
        if (pill2) {
            pill2.style.background = "#27272a";
            pill2.style.color = "#a1a1aa";
            pill2.innerHTML = '<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:rgba(255,255,255,0.1); font-size:10px; font-weight:bold;">2</span> <span>settings</span>';
        }
    }
}

var SILENCE_PRESETS = {
    calm:      { threshold: -40, minSilence: 500, minTalk: 150, marginBefore: 250, marginAfter: 250 },
    measured:  { threshold: -38, minSilence: 350, minTalk: 120, marginBefore: 180, marginAfter: 180 },
    paced:     { threshold: -36, minSilence: 250, minTalk: 100, marginBefore: 120, marginAfter: 120 },
    energetic: { threshold: -34, minSilence: 180, minTalk: 80,  marginBefore: 80,  marginAfter: 80 },
    jumpy:     { threshold: -32, minSilence: 100, minTalk: 50,  marginBefore: 50,  marginAfter: 50 }
};

function applySilencePreset(name) {
    var p = SILENCE_PRESETS[name];
    if (!p) return;
    silencesState.preset = name;

    document.querySelectorAll(".preset-pill").forEach(function(pill) {
        if (pill.dataset.preset === name) {
            pill.classList.add("active");
            pill.style.background = "#8fbc8f";
            pill.style.borderColor = "#8fbc8f";
            pill.style.color = "#fff";
        } else {
            pill.classList.remove("active");
            pill.style.background = "#27272a";
            pill.style.borderColor = "#3f3f46";
            pill.style.color = "#f4f4f5";
        }
    });

    var rng = document.getElementById("rngSilenceThreshold");
    if (rng) rng.value = p.threshold;
    var lbl = document.getElementById("lblSilenceThreshold");
    if (lbl) lbl.textContent = p.threshold + "db";

    var nMinSil = document.getElementById("numMinSilenceMs");
    if (nMinSil) nMinSil.value = p.minSilence;
    var nMinTalk = document.getElementById("numMinTalkMs");
    if (nMinTalk) nMinTalk.value = p.minTalk;
    var nPadB = document.getElementById("numMarginBeforeMs");
    if (nPadB) nPadB.value = p.marginBefore;
    var nPadA = document.getElementById("numMarginAfterMs");
    if (nPadA) nPadA.value = p.marginAfter;
}

function calculateAIThreshold() {
    updateSelectedSilencesTracks();
    if (silencesState.selectedTrackIndices.length === 0) {
        logSilences("please select at least one track first.");
        return;
    }
    logSilences("analyzing ambient room noise to calculate optimal threshold...");

    var params = {
        trackIndices: silencesState.selectedTrackIndices,
        scope: silencesState.scope
    };

    hostCall("autoCutExportSelectedAudio", JSON.stringify(params), function(raw) {
        var res;
        try { res = JSON.parse(raw); } catch(e) {}
        if (!res || !res.wavPath) {
            logSilences("error rendering audio for threshold: " + (res ? res.error : raw));
            return;
        }

        hostCall("getRuntimeFolder", undefined, function(rf) {
            var reqPath = rf + "\\thresh_req.json";
            var outPath = rf + "\\thresh_out.json";
            var request = { mode: "calculate_noise_floor", wavPath: res.wavPath };

            hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(request) }), function() {
                var python = "C:\\Program Files\\Python313\\python.exe";
                var script = EXTENSION_ROOT + "\\ai_processor.py";

                hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:reqPath, output:outPath, logPath:rf + "\\thresh.log" }), function() {
                    var timer = setInterval(function() {
                        hostCall("readTextFile", outPath, function(content) {
                            if (content && content.indexOf("recommendedThreshold") !== -1) {
                                clearInterval(timer);
                                try {
                                    var data = JSON.parse(content);
                                    if (data.success && data.recommendedThreshold !== undefined) {
                                        var rng = document.getElementById("rngSilenceThreshold");
                                        if (rng) rng.value = data.recommendedThreshold;
                                        var lbl = document.getElementById("lblSilenceThreshold");
                                        if (lbl) lbl.textContent = data.recommendedThreshold + "db";
                                        logSilences("ai calculated room noise floor at " + data.noiseFloorDb + "db. optimal threshold set to: " + data.recommendedThreshold + "db.");
                                    }
                                } catch(e) {}
                            }
                        });
                    }, 500);
                });
            });
        });
    }, 900000);
}

function drawInitialWaveformPlaceholder() {
    var canvas = document.getElementById("silencesWaveformCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#18181b");
    grad.addColorStop(1, "#09090b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    var numBars = 75;
    var barW = w / numBars;
    for (var i = 0; i < numBars; i++) {
        var barH = Math.sin(i * 0.2) * (h * 0.35) + (h * 0.4);
        ctx.fillRect(i * barW + 1, (h - barH) / 2, barW - 2, barH);
    }
}

function drawSilencesWaveformResult(totalDuration, talks, silences) {
    var canvas = document.getElementById("silencesWaveformCanvas");
    if (!canvas || totalDuration <= 0) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#111114";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#8fbc8f";
    talks.forEach(function(t) {
        var x1 = (t.start / totalDuration) * w;
        var x2 = (t.end / totalDuration) * w;
        var segW = Math.max(2, x2 - x1);
        ctx.fillRect(x1, 10, segW, h - 20);
    });

    ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
    silences.forEach(function(s) {
        var x1 = (s.start / totalDuration) * w;
        var x2 = (s.end / totalDuration) * w;
        var segW = Math.max(1, x2 - x1);
        ctx.fillRect(x1, 0, segW, h);
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(x1, 0, 1.5, h);
        ctx.fillRect(x2, 0, 1.5, h);
        ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
    });

    var ov = document.getElementById("silencesPreviewOverlay");
    if (ov) ov.style.display = "none";
}

// ------------------------------------------------------------
// NEW PIPELINE (no Premiere audio render): analysis runs directly
// on the selected clips' source files, mapped onto the timeline.
// Falls back to the legacy render-based pipeline automatically.
// ------------------------------------------------------------

function collectSilenceSettings() {
    function pickNum(id, d) { var el = document.getElementById(id); return el ? parseFloat(el.value) : d; }
    var radMgmt = document.querySelector("input[name='radSilenceMgmt']:checked");
    var radTrans = document.querySelector("input[name='radSilenceTransition']:checked");
    var thrEl = document.getElementById("rngSilenceThreshold") || document.getElementById("numSilenceThreshold");
    return {
        threshold: thrEl ? parseFloat(thrEl.value) : -38.0,
        minSilenceMs: pickNum("numMinSilenceMs", 150.0),
        minTalkMs: pickNum("numMinTalkMs", 100.0),
        marginBeforeMs: pickNum("numMarginBeforeMs", 100.0),
        marginAfterMs: pickNum("numMarginAfterMs", 100.0),
        management: radMgmt ? radMgmt.value : "remove",
        transition: radTrans ? radTrans.value : "none"
    };
}

function runSilenceAnalysisJob(reqData, onResult, label) {
    hostCall("getRuntimeFolder", undefined, function(rf) {
        var runId = Date.now() + "_" + Math.floor(Math.random() * 1000);
        var reqPath = rf + "\\silence_job_req_" + runId + ".json";
        var outPath = rf + "\\silence_job_out_" + runId + ".json";
        var logPath = rf + "\\silence_job_log_" + runId + ".log";

        hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(reqData) }), function() {
            var python = "C:\\Program Files\\Python313\\python.exe";
            var script = EXTENSION_ROOT + "\\ai_processor.py";

            hostCall("runBatchScript", JSON.stringify({ python: python, script: script, request: reqPath, output: outPath, logPath: logPath }), function() {
                var pollStart = Date.now();
                var pollDone = false; // HARD GUARD: consume the result exactly once
                var pollTimer = setInterval(function() {
                    if (pollDone) return;
                    if (Date.now() - pollStart > 300000) {
                        pollDone = true;
                        clearInterval(pollTimer);
                        hostCall("readTextFile", logPath, function(logContent) {
                            logSilences((label || "analysis") + " timed out. python log: " + (logContent || "no output"));
                        });
                        onResult(null);
                        return;
                    }
                    hostCall("readTextFile", outPath, function(outContent) {
                        if (pollDone) return;
                        if (!outContent) return;
                        var isReady = (outContent.indexOf("\"success\"") !== -1 || outContent.indexOf("silences") !== -1 || outContent.indexOf("segments") !== -1 || outContent.indexOf("error") !== -1);
                        if (isReady) {
                            var parsed = null;
                            try {
                                parsed = JSON.parse(outContent);
                            } catch (e) {
                                return; // File still being written by Python, wait for next tick
                            }
                            if (parsed) {
                                pollDone = true;
                                clearInterval(pollTimer);
                                onResult(parsed);
                            }
                        }
                    });
                }, 500);
            });
        });
    });
}

function runSilenceClipDirectAnalysis(settings, cb) {
    var params = { trackIndices: silencesState.selectedTrackIndices, scope: silencesState.scope };
    hostCall("autoCutGetTrackClipsForSilence", JSON.stringify(params), function(raw) {
        var res;
        try { res = JSON.parse(raw); } catch(e) {}
        if (!res || !res.success || !res.clips || res.clips.length === 0) {
            cb(null, null);
            return;
        }
        var reqData = {
            mode: "analyze_silences_from_clips",
            clips: res.clips,
            threshold: settings.threshold,
            minSilenceMs: settings.minSilenceMs,
            minTalkMs: settings.minTalkMs,
            marginBeforeMs: settings.marginBeforeMs,
            marginAfterMs: settings.marginAfterMs,
            scope: silencesState.scope,
            seqInPoint: res.inPoint,
            seqOutPoint: res.outPoint
        };
        var meta = { sequenceName: res.sequenceName, fps: res.fps || 30.0 };
        runSilenceAnalysisJob(reqData, function(anaRes) { cb(anaRes, meta); }, "clip-analysis");
    });
}

function finishSilenceCut(anaRes, meta, settings, resetBtn) {
    var silences = anaRes.silences || [];
    drawSilencesWaveformResult(anaRes.totalDuration, anaRes.talks || [], silences);

    if (silences.length === 0) {
        logSilences("no silences detected matching your parameters.");
        finishProcessOverlay(false, "no silences detected matching your parameters.");
        resetBtn();
        return;
    }

    // SAFETY: never run a plan that would erase almost the entire timeline.
    if (anaRes.timeSavedPct >= 97) {
        logSilences("safety stop: analysis says " + anaRes.timeSavedPct + "% of the timeline is silence. that would delete everything.");
        logSilences("verify the correct audio track is selected and unmuted, then try again.");
        finishProcessOverlay(false, "safety stop: " + anaRes.timeSavedPct + "% of timeline measured as silence — check track selection.");
        resetBtn();
        return;
    }

    logSilences("[2/2] executing " + settings.management + " across Premiere timeline (" + silences.length + " silence intervals, " + anaRes.timeSaved + "s saved)...");
    if (typeof advanceProcessStep === "function") advanceProcessStep(3);

    var plan = {
        silences: silences,
        management: settings.management,
        transition: settings.transition,
        targetTracks: silencesState.selectedTrackIndices,
        targetSequenceName: (meta && meta.sequenceName) || "",
        fps: (meta && meta.fps) || 30.0
    };

    hostCall("autoCutExecuteSilenceCuts", JSON.stringify(plan), function(cutResRaw) {
        advanceProcessStep(4);
        resetBtn();
        var cutRes;
        try { cutRes = JSON.parse(cutResRaw); } catch(e) {}
        if (cutRes && cutRes.success) {
            var doneMsg = cutRes.message + " (" + anaRes.timeSaved + "s removed, " + anaRes.timeSavedPct + "% time saved).";
            logSilences(doneMsg);
            finishProcessOverlay(true, doneMsg);
        } else {
            logSilences("cutting error: " + (cutRes ? cutRes.error : cutResRaw));
            finishProcessOverlay(false, "cutting error: " + (cutRes ? cutRes.error : "unknown"));
        }
    }, 900000);
}

function executeAutoCutSilences() {
    if (autoCutSilencesRunning) return; // HARD GUARD: never two cutting runs at once
    updateSelectedSilencesTracks();
    if (silencesState.selectedTrackIndices.length === 0) {
        logSilences("please select at least one audio track first.");
        return;
    }

    var settings = collectSilenceSettings();
    autoCutSilencesRunning = true;

    var btn = document.getElementById("btnSilencesExecute");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳ analyzing & cutting silences...";
    }

    function resetBtn() {
        autoCutSilencesRunning = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = "cut and delete silences";
        }
    }

    logSilences("[1/2] analyzing audio directly from source clips on disk (no render needed, usually seconds)...");
    if (typeof showProcessOverlay === "function") showProcessOverlay("silences");

    runSilenceClipDirectAnalysis(settings, function(anaRes, meta) {
        if (anaRes && anaRes.success) {
            advanceProcessStep(2);
            finishSilenceCut(anaRes, meta, settings, resetBtn);
            return;
        }
        var err = (anaRes && anaRes.error) ? anaRes.error : "could not read source clips";
        logSilences("direct clip analysis unavailable: " + err);
        logSilences("falling back to rendering the timeline audio (this can take a minute on long sequences)...");
        hideProcessOverlay(); // legacy render path drives its own inline progress
        autoCutSilencesRunning = false; // legacy path manages its own guard/button running state
        executeAutoCutSilencesLegacy();
    });
}

function executeAutoCutSilencesPreview(isFast) {
    updateSelectedSilencesTracks();
    if (silencesState.selectedTrackIndices.length === 0) {
        logSilences("please select at least one audio track.");
        return;
    }

    var settings = collectSilenceSettings();
    logSilences("generating waveform preview directly from source clips (no render needed)...");
    runSilenceClipDirectAnalysis(settings, function(anaRes) {
        if (anaRes && anaRes.success) {
            drawSilencesWaveformResult(anaRes.totalDuration, anaRes.talks || [], anaRes.silences || []);
            logSilences("preview ready: " + anaRes.silences.length + " silences detected (" + anaRes.timeSaved + "s will be removed, " + anaRes.timeSavedPct + "% time saved).");
            return;
        }
        var err = (anaRes && anaRes.error) ? anaRes.error : "could not read source clips";
        logSilences("direct clip preview unavailable: " + err + " — falling back to rendering timeline audio...");
        executeAutoCutSilencesPreviewLegacy(isFast);
    });
}

function executeAutoCutSilencesPreviewLegacy(isFast) {
    updateSelectedSilencesTracks();
    if (silencesState.selectedTrackIndices.length === 0) {
        logSilences("please select at least one audio track.");
        return;
    }

    var threshEl = document.getElementById("rngSilenceThreshold");
    var threshold = threshEl ? parseFloat(threshEl.value) : -38.0;

    var minSilEl = document.getElementById("numMinSilenceMs");
    var minSilenceMs = minSilEl ? parseFloat(minSilEl.value) : 150.0;

    var minTalkEl = document.getElementById("numMinTalkMs");
    var minTalkMs = minTalkEl ? parseFloat(minTalkEl.value) : 100.0;

    var padBEl = document.getElementById("numMarginBeforeMs");
    var marginBeforeMs = padBEl ? parseFloat(padBEl.value) : 100.0;

    var padAEl = document.getElementById("numMarginAfterMs");
    var marginAfterMs = padAEl ? parseFloat(padAEl.value) : 100.0;

    logSilences("generating waveform preview for tracks (" + silencesState.selectedTrackIndices.map(function(i) { return "a" + (i+1); }).join(", ") + ")... (long sequences can take a minute or two to render)");

    var exportParams = {
        trackIndices: silencesState.selectedTrackIndices,
        scope: silencesState.scope
    };

    hostCall("autoCutExportSelectedAudio", JSON.stringify(exportParams), function(rawExport) {
        var expRes;
        try { expRes = JSON.parse(rawExport); } catch(e) {}
        if (!expRes || !expRes.wavPath) {
            logSilences("error rendering preview audio: " + (expRes ? expRes.error : rawExport));
            return;
        }

        hostCall("getRuntimeFolder", undefined, function(rf) {
            var runId = Date.now();
            var reqPath = rf + "\\silence_prev_req_" + runId + ".json";
            var outPath = rf + "\\silence_prev_out_" + runId + ".json";
            var logPath = rf + "\\silence_prev_log_" + runId + ".log";

            var reqData = {
                mode: "analyze_silences",
                wavPath: expRes.wavPath,
                threshold: threshold,
                minSilenceMs: minSilenceMs,
                minTalkMs: minTalkMs,
                marginBeforeMs: marginBeforeMs,
                marginAfterMs: marginAfterMs,
                scopeOffset: 0.0
            };

            hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(reqData) }), function() {
                var python = "C:\\Program Files\\Python313\\python.exe";
                var script = EXTENSION_ROOT + "\\ai_processor.py";

                hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:reqPath, output:outPath, logPath:logPath }), function(rbsRes) {
                    var pollStart = Date.now();
                    var pollDone = false; // HARD GUARD: only ever process the result once
                    var pollTimer = setInterval(function() {
                        if (pollDone) return;
                        if (Date.now() - pollStart > 300000) {
                            pollDone = true;
                            clearInterval(pollTimer);
                            hostCall("readTextFile", logPath, function(logContent) {
                                logSilences("preview analysis timed out. python log: " + (logContent || "no output"));
                            });
                            return;
                        }
                        hostCall("readTextFile", outPath, function(outContent) {
                            if (pollDone) return;
                            if (outContent && (outContent.indexOf("silences") !== -1 || outContent.indexOf("error") !== -1)) {
                                pollDone = true;
                                clearInterval(pollTimer);
                                try {
                                    var anaRes = JSON.parse(outContent);
                                    if (anaRes.success) {
                                        drawSilencesWaveformResult(anaRes.totalDuration, anaRes.talks || [], anaRes.silences || []);
                                        logSilences("preview ready: " + anaRes.silences.length + " silences detected (" + anaRes.timeSaved + "s will be removed, " + anaRes.timeSavedPct + "% time saved).");
                                    } else {
                                        logSilences("preview failed: " + (anaRes.error || "unknown error"));
                                    }
                                } catch(e) {}
                            }
                        });
                    }, 500);
                });
            });
        });
    }, 900000);
}

var autoCutSilencesRunning = false;

function executeAutoCutSilencesLegacy() {
    if (autoCutSilencesRunning) return; // HARD GUARD: never two cutting runs at once
    updateSelectedSilencesTracks();
    if (silencesState.selectedTrackIndices.length === 0) {
        logSilences("please select at least one audio track first.");
        return;
    }

    var thresholdEl = document.getElementById("rngSilenceThreshold") || document.getElementById("numSilenceThreshold");
    var threshold = thresholdEl ? parseFloat(thresholdEl.value) : -38.0;

    var minSilEl = document.getElementById("numMinSilenceMs");
    var minSilenceMs = minSilEl ? parseFloat(minSilEl.value) : 150.0;

    var minTalkEl = document.getElementById("numMinTalkMs");
    var minTalkMs = minTalkEl ? parseFloat(minTalkEl.value) : 100.0;

    var padBEl = document.getElementById("numMarginBeforeMs");
    var marginBeforeMs = padBEl ? parseFloat(padBEl.value) : 100.0;

    var padAEl = document.getElementById("numMarginAfterMs");
    var marginAfterMs = padAEl ? parseFloat(padAEl.value) : 100.0;

    var radMgmt = document.querySelector("input[name='radSilenceMgmt']:checked");
    var management = radMgmt ? radMgmt.value : "remove";

    var radTrans = document.querySelector("input[name='radSilenceTransition']:checked");
    var transition = radTrans ? radTrans.value : "none";

    autoCutSilencesRunning = true;

    var btn = document.getElementById("btnSilencesExecute");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳ analyzing & cutting silences...";
    }

    function resetBtn() {
        autoCutSilencesRunning = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = "cut and delete silences";
        }
    }

    logSilences("[1/3] exporting audio for selected tracks (" + silencesState.selectedTrackIndices.map(function(i) { return "a" + (i+1); }).join(", ") + ")...");

    var exportParams = {
        trackIndices: silencesState.selectedTrackIndices,
        scope: silencesState.scope
    };

    hostCall("autoCutExportSelectedAudio", JSON.stringify(exportParams), function(rawExport) {
        var expRes;
        try { expRes = JSON.parse(rawExport); } catch(e) {}
        if (!expRes || !expRes.wavPath) {
            logSilences("error exporting audio: " + (expRes ? expRes.error : rawExport));
            resetBtn();
            return;
        }

        var wavPath = expRes.wavPath;
        var scopeOffset = (silencesState.scope === "inout" && expRes.inPoint) ? expRes.inPoint : 0.0;

        logSilences("[2/3] analyzing audio energy & detecting silences with AI (threshold: " + threshold + "db)...");

        hostCall("getRuntimeFolder", undefined, function(rf) {
            var runId = Date.now();
            var reqPath = rf + "\\silence_analysis_req_" + runId + ".json";
            var outPath = rf + "\\silence_analysis_out_" + runId + ".json";
            var logPath = rf + "\\silence_analysis_log_" + runId + ".log";

            var reqData = {
                mode: "analyze_silences",
                wavPath: wavPath,
                threshold: threshold,
                minSilenceMs: minSilenceMs,
                minTalkMs: minTalkMs,
                marginBeforeMs: marginBeforeMs,
                marginAfterMs: marginAfterMs,
                scopeOffset: scopeOffset
            };

            hostCall("writeTextFile", JSON.stringify({ path: reqPath, text: JSON.stringify(reqData) }), function() {
                var python = "C:\\Program Files\\Python313\\python.exe";
                var script = EXTENSION_ROOT + "\\ai_processor.py";

                hostCall("runBatchScript", JSON.stringify({ python:python, script:script, request:reqPath, output:outPath, logPath:logPath }), function() {
                    var pollStart = Date.now();
                    var pollDone = false; // HARD GUARD: process the analysis result exactly once
                    var pollTimer = setInterval(function() {
                        if (pollDone) return;
                        if (Date.now() - pollStart > 300000) {
                            pollDone = true;
                            clearInterval(pollTimer);
                            resetBtn();
                            hostCall("readTextFile", logPath, function(logContent) {
                                logSilences("analysis timed out after 5 minutes. python log: " + (logContent || "no output"));
                            });
                            return;
                        }
                        hostCall("readTextFile", outPath, function(outContent) {
                            if (pollDone) return;
                            if (outContent && (outContent.indexOf("silences") !== -1 || outContent.indexOf("error") !== -1)) {
                                pollDone = true;
                                clearInterval(pollTimer);
                                try {
                                    var anaRes = JSON.parse(outContent);
                                    if (anaRes.success) {
                                        var silences = anaRes.silences || [];
                                        var talks = anaRes.talks || [];
                                        drawSilencesWaveformResult(anaRes.totalDuration, talks, silences);

                                        if (silences.length === 0) {
                                            logSilences("no silences detected matching your parameters.");
                                            resetBtn();
                                            return;
                                        }

                                        // SAFETY: if the plan would erase almost the whole timeline, the
                                        // exported render was almost certainly silent/wrong. never cut it.
                                        if (anaRes.timeSavedPct >= 97) {
                                            logSilences("safety stop: analysis says " + anaRes.timeSavedPct + "% of the timeline is silence. that would delete everything.");
                                            logSilences("your render is available to audition here: " + wavPath);
                                            logSilences("verify the correct audio track is selected and unmuted, then try again.");
                                            resetBtn();
                                            return;
                                        }

                                        logSilences("[3/3] executing " + management + " across Premiere timeline (" + silences.length + " silence intervals, " + anaRes.timeSaved + "s saved)...");

                                        var plan = {
                                            silences: silences,
                                            management: management,
                                            transition: transition,
                                            targetTracks: silencesState.selectedTrackIndices,
                                            targetSequenceName: expRes.sequenceName,
                                            fps: expRes.fps || 30.0
                                        };

                                        hostCall("autoCutExecuteSilenceCuts", JSON.stringify(plan), function(cutResRaw) {
                                            resetBtn();
                                            var cutRes;
                                            try { cutRes = JSON.parse(cutResRaw); } catch(e) {}
                                            if (cutRes && cutRes.success) {
                                                logSilences(cutRes.message + " (" + anaRes.timeSaved + "s removed, " + anaRes.timeSavedPct + "% time saved).");
                                            } else {
                                                logSilences("cutting error: " + (cutRes ? cutRes.error : cutResRaw));
                                            }
                                        }, 900000);
                                    } else {
                                        resetBtn();
                                        logSilences("silence detection error: " + (anaRes.error || "unknown error"));
                                    }
                                } catch(e) {
                                    resetBtn();
                                    logSilences("error parsing analysis output: " + e.toString());
                                }
                            }
                        });
                    }, 500);
                });
            });
        });
    }, 900000);
}

function switchView(viewName) {
    currentView = viewName || "hub";
    document.querySelectorAll(".app-view").forEach(function(el) {
        el.classList.remove("active");
    });
    var targetId = "viewHub";
    if (viewName === "heads") targetId = "viewHeads";
    if (viewName === "sfx") targetId = "viewSFX";
    if (viewName === "aivoice") targetId = "viewAIVoice";
    if (viewName === "silences") targetId = "viewSilences";
    if (viewName === "pov") targetId = "viewPOV";
    if (viewName === "separate") targetId = "viewSeparate";
    
    var target = document.getElementById(targetId);
    if (target) target.classList.add("active");

    var backBtn = document.getElementById("btnBackToHub");
    if (backBtn) {
        if (currentView === "hub") {
            backBtn.classList.add("hidden");
        } else {
            backBtn.classList.remove("hidden");
        }
    }
    try { localStorage.setItem("opencut_active_view", currentView); } catch(e) {}

    if (viewName === "silences") {
        loadSilencesSequenceTracks();
    }
    if (viewName === "pov") {
        loadPOVSequenceTracks();
    }
    if (viewName === "separate") {
        loadSepSequenceTracks();
    }
}

// ============================================================
// AUTOSEPARATE CONTROLLER
// ============================================================

var separateState = {
    scope: "entire",
    audioTracks: [],
    selectedTrackIndex: 0,
    numSpeakers: 3,
    inPoint: 0.0,
    outPoint: 0.0,
    hasInOut: false,
    sequenceName: "",
    fps: 30.0,
    threshold: -38.0,
    analysisResult: null,
    wavPath: "",
    running: false
};

function logSep(msg) {
    var el = document.getElementById("consoleLogSep");
    if (!el) return;
    var time = new Date().toLocaleTimeString().toLowerCase();
    el.innerHTML += "<div><span style='color:#71717a;'>[" + time + "]</span> " + msg + "</div>";
    el.scrollTop = el.scrollHeight;
}

function loadSepSequenceTracks() {
    hostCall("autoCutGetSequenceTracks", undefined, function(raw) {
        var res;
        try { res = JSON.parse(raw); } catch(e) {}
        if (!res || !res.success) {
            logSep("could not inspect sequence: " + (res ? res.error : raw));
            return;
        }
        separateState.audioTracks = res.audioTracks || [];
        separateState.inPoint = res.inPoint || 0.0;
        separateState.outPoint = res.outPoint || 0.0;
        separateState.hasInOut = res.hasInOut || false;
        separateState.sequenceName = res.sequenceName || "";
        renderSepTrackList();
        updateSepDurationLabel();
        logSep("detected " + separateState.audioTracks.length + " audio track(s) in sequence: " + separateState.sequenceName + ".");
    });
}

function updateSepDurationLabel() {
    var lbl = document.getElementById("lblSepDuration");
    if (!lbl) return;
    var startStr = (separateState.scope === "inout" && separateState.hasInOut) ? formatTimecodeSeconds(separateState.inPoint) : "00:00:00";
    var endStr = (separateState.scope === "inout" && separateState.hasInOut) ? formatTimecodeSeconds(separateState.outPoint) : "00:00:00";
    lbl.textContent = startStr + " - " + endStr;
}

function renderSepTrackList() {
    var container = document.getElementById("sepTrackList");
    if (!container) return;
    if (separateState.audioTracks.length === 0) {
        container.innerHTML = '<div style="color:#71717a; font-size:11px; text-align:center; padding:10px;">no audio tracks found.</div>';
        return;
    }
    container.innerHTML = "";
    separateState.audioTracks.forEach(function(trk) {
        var row = document.createElement("label");
        row.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.02); cursor: pointer; font-size: 12px;";
        var rb = document.createElement("input");
        rb.type = "radio";
        rb.name = "sepTrackRadio";
        rb.value = trk.index;
        rb.checked = (trk.index === separateState.selectedTrackIndex);
        rb.style.accentColor = "#8fbc8f";
        rb.addEventListener("change", function() {
            if (rb.checked) separateState.selectedTrackIndex = parseInt(rb.value, 10);
        });
        var nameSpan = document.createElement("span");
        nameSpan.style.fontWeight = "bold";
        nameSpan.textContent = trk.name.toLowerCase();
        var countSpan = document.createElement("span");
        countSpan.style.cssText = "color: #71717a; font-size: 10px;";
        countSpan.textContent = "(" + trk.clipCount + " clips)";
        row.appendChild(rb);
        row.appendChild(nameSpan);
        row.appendChild(countSpan);
        container.appendChild(row);
    });
}

function setSepScope(scope) {
    separateState.scope = scope;
    var btnEntire = document.getElementById("btnSepScopeEntire");
    var btnInOut = document.getElementById("btnSepScopeInOut");
    if (scope === "entire") {
        if (btnEntire) { btnEntire.style.borderColor = "#8fbc8f"; btnEntire.style.background = "rgba(143, 188, 143, 0.12)"; btnEntire.style.color = "#f4f4f5"; btnEntire.classList.add("active"); }
        if (btnInOut) { btnInOut.style.borderColor = "#27272a"; btnInOut.style.background = "#18181b"; btnInOut.style.color = "#a1a1aa"; btnInOut.classList.remove("active"); }
    } else {
        if (btnInOut) { btnInOut.style.borderColor = "#8fbc8f"; btnInOut.style.background = "rgba(143, 188, 143, 0.12)"; btnInOut.style.color = "#f4f4f5"; btnInOut.classList.add("active"); }
        if (btnEntire) { btnEntire.style.borderColor = "#27272a"; btnEntire.style.background = "#18181b"; btnEntire.style.color = "#a1a1aa"; btnEntire.classList.remove("active"); }
    }
    updateSepDurationLabel();
}

function goToSepStep(step) {
    var step1 = document.getElementById("sepStep1");
    var step2 = document.getElementById("sepStep2");
    var pill1 = document.getElementById("sepStepPillSections");
    var pill2 = document.getElementById("sepStepPilSeparate");
    if (step === 2) {
        if (step1) step1.style.display = "none";
        if (step2) step2.style.display = "block";
        if (pill1) { pill1.style.background = "#27272a"; pill1.style.color = "#a1a1aa"; pill1.innerHTML = '<span style="color:#8fbc8f; font-weight:bold;">\u2713</span> <span>source</span>'; }
        if (pill2) { pill2.style.background = "#8fbc8f"; pill2.style.color = "#18181b"; }
    } else {
        if (step1) step1.style.display = "block";
        if (step2) step2.style.display = "none";
        if (pill1) { pill1.style.background = "#8fbc8f"; pill1.style.color = "#18181b"; }
        if (pill2) { pill2.style.background = "#27272a"; pill2.style.color = "#a1a1aa"; }
    }
}

function analyzeSepSpeakers() {
    if (separateState.running) return;
    var numEl = document.getElementById("numSepSpeakers");
    separateState.numSpeakers = numEl ? parseInt(numEl.value, 10) : 3;
    separateState.running = true;

    var btn = document.getElementById("btnSepAnalyze");
    if (btn) { btn.disabled = true; btn.textContent = "\u23f3 analyzing..."; }
    function resetBtn() { separateState.running = false; if (btn) { btn.disabled = false; btn.textContent = "analyze & separate speakers"; } }

    logSep("[1/2] exporting source audio for analysis...");
    if (typeof showProcessOverlay === "function") showProcessOverlay("separate", "rendering source audio...");

    var exportParams = { trackIndices: [separateState.selectedTrackIndex], scope: separateState.scope };
    hostCall("autoCutExportSelectedAudio", JSON.stringify(exportParams), function(rawExport) {
        var expRes;
        try { expRes = JSON.parse(rawExport); } catch(e) {}
        if (!expRes || !expRes.wavPath) {
            logSep("export failed: " + (expRes ? expRes.error : rawExport));
            finishProcessOverlay(false, "audio export failed.");
            resetBtn();
            return;
        }

        separateState.wavPath = expRes.wavPath;
        advanceProcessStep(1);
        logSep("[2/2] running multi-layer speaker diarization (" + separateState.numSpeakers + " speakers, threshold " + separateState.threshold + "db)...");

        var thrEl = document.getElementById("rngSepThreshold");
        var threshold = thrEl ? parseFloat(thrEl.value) : -38.0;
        separateState.threshold = threshold;

        var reqData = {
            mode: "separate_speakers",
            wavPath: expRes.wavPath,
            numSpeakers: separateState.numSpeakers,
            threshold: threshold,
            minSpeechMs: 300.0,
            minSilenceMs: 200.0,
            marginMs: 80.0,
            scope: separateState.scope,
            seqInPoint: expRes.inPoint || 0.0,
            seqOutPoint: expRes.outPoint || 0.0
        };

        runSilenceAnalysisJob(reqData, function(anaRes) {
            resetBtn();
            if (!anaRes || !anaRes.success) {
                logSep("analysis failed: " + (anaRes ? anaRes.error : "unknown"));
                finishProcessOverlay(false, anaRes ? anaRes.error : "analysis failed.");
                return;
            }

            separateState.analysisResult = anaRes;
            advanceProcessStep(3);
            renderSepSpeakerSummary(anaRes);
            goToSepStep(2);
            finishProcessOverlay(true, "detected " + anaRes.numSpeakers + " speaker(s), " + anaRes.segments.length + " segment(s).");
            logSep("analysis complete: " + anaRes.numSpeakers + " speaker(s), " + anaRes.segments.length + " segment(s), silhouette score: " + anaRes.silhouetteScore + ".");
        }, "speaker separation");
    }, 900000);
}

function renderSepSpeakerSummary(anaRes) {
    var container = document.getElementById("sepSpeakerSummary");
    if (!container) return;
    container.innerHTML = "";

    var summary = anaRes.speakerSummary || [];
    summary.forEach(function(sp) {
        var card = document.createElement("div");
        card.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 8px; background: #18181b; border: 1px solid #27272a;";

        var left = document.createElement("div");
        left.style.cssText = "display: flex; align-items: center; gap: 10px;";

        var dot = document.createElement("span");
        dot.style.cssText = "display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #8fbc8f; opacity: " + (0.3 + 0.7 * (sp.speaker + 1) / (summary.length + 1)) + ";";

        var info = document.createElement("div");
        info.innerHTML = '<span style="font-weight: bold; color: #f4f4f5;">speaker ' + (sp.speaker + 1) + '</span> <span style="color: #71717a; font-size: 10px;">(' + sp.voiceType + ')</span><br><span style="font-size: 10px; color: #a1a1aa;">' + sp.segments + ' segments, ' + sp.totalSpoken + 's spoken, avg F0: ' + sp.avgF0 + ' Hz</span>';

        left.appendChild(dot);
        left.appendChild(info);
        card.appendChild(left);
        container.appendChild(card);
    });
}

function executeSepSeparate() {
    if (separateState.running) return;
    if (!separateState.analysisResult || !separateState.analysisResult.segments || !separateState.analysisResult.segments.length) {
        logSep("no analysis to execute. run the analysis first.");
        return;
    }

    separateState.running = true;
    var btn = document.getElementById("btnSepExecute");
    if (btn) { btn.disabled = true; btn.textContent = "\u23f3 separating..."; }
    function resetBtn() { separateState.running = false; if (btn) { btn.disabled = false; btn.textContent = "separate onto individual tracks"; } }

    var chkMute = document.getElementById("chkSepMuteSource");
    var muteSource = chkMute ? chkMute.checked : true;

    logSep("separating " + separateState.analysisResult.segments.length + " segment(s) onto " + separateState.numSpeakers + " track(s)...");
    if (typeof showProcessOverlay === "function") showProcessOverlay("separate", "separating onto tracks...");

    var plan = {
        segments: separateState.analysisResult.segments,
        numSpeakers: separateState.numSpeakers,
        sourceTrack: separateState.selectedTrackIndex,
        targetSequenceName: separateState.sequenceName,
        fps: separateState.fps,
        wavPath: separateState.wavPath,
        muteSourceTrack: muteSource
    };

    advanceProcessStep(4);
    hostCall("separateExecuteTracks", JSON.stringify(plan), function(rawRes) {
        advanceProcessStep(5);
        resetBtn();
        var res;
        try { res = JSON.parse(rawRes); } catch(e) {}
        if (res && res.success) {
            logSep(res.message);
            finishProcessOverlay(true, res.message);
        } else {
            logSep("separation error: " + (res ? res.error : rawRes));
            finishProcessOverlay(false, res ? res.error : "separation failed.");
        }
    }, 900000);
}

document.addEventListener("DOMContentLoaded", function() {
    loadConfig();
    loadSfxState();
    renderHeadsCharacters();
    renderTracks();
    syncTracks();

    // View Navigation
    var cardLaunchHeads = document.getElementById("cardLaunchHeads");
    if (cardLaunchHeads) cardLaunchHeads.addEventListener("click", function() { switchView("heads"); });

    var cardLaunchSFX = document.getElementById("cardLaunchSFX");
    if (cardLaunchSFX) cardLaunchSFX.addEventListener("click", function() { switchView("sfx"); });

    var cardMiniSilences = document.getElementById("cardMiniSilences");
    if (cardMiniSilences) cardMiniSilences.addEventListener("click", function() { switchView("silences"); });

    var cardMiniCaptions = document.getElementById("cardMiniCaptions");
    if (cardMiniCaptions) cardMiniCaptions.addEventListener("click", function() { switchView("pov"); });

    var cardMiniSeparate = document.getElementById("cardMiniSeparate");
    if (cardMiniSeparate) cardMiniSeparate.addEventListener("click", function() { switchView("separate"); });

    var cardMiniZoom = document.getElementById("cardMiniZoom");
    if (cardMiniZoom) cardMiniZoom.addEventListener("click", function() { switchView("aivoice"); });

    var btnBackToHub = document.getElementById("btnBackToHub");
    if (btnBackToHub) btnBackToHub.addEventListener("click", function() { switchView("hub"); });

    var brandLogo = document.getElementById("brandLogo");
    if (brandLogo) brandLogo.addEventListener("click", function() { switchView("hub"); });

    document.querySelectorAll(".btn-return-hub").forEach(function(btn) {
        btn.addEventListener("click", function() { switchView("hub"); });
    });

    var btnHubSync = document.getElementById("btnHubSync");
    if (btnHubSync) btnHubSync.addEventListener("click", syncTracks);

    var btnHubConsole = document.getElementById("btnHubConsole");
    if (btnHubConsole) btnHubConsole.addEventListener("click", function() { setDebugVisible(!deepConsoleVisible); });

    // Heads Tool Actions
    var btnGenerate = document.getElementById("btnGenerate");
    if (btnGenerate) btnGenerate.addEventListener("click", startRun);
    var btnSyncTracks = document.getElementById("btnSyncTracks");
    if (btnSyncTracks) btnSyncTracks.addEventListener("click", syncTracks);
    
    var btnTest = document.getElementById("btnTestHost");
    if (btnTest) btnTest.addEventListener("click", testHost);
    
    var btnDebug = document.getElementById("btnDebugToggle");
    if (btnDebug) btnDebug.addEventListener("click", function() { setDebugVisible(!deepConsoleVisible); });
    
    var btnCancel = document.getElementById("btnCancel");
    if (btnCancel) btnCancel.addEventListener("click", function() { finishRun(false, "Tracking cancelled."); });
    document.getElementById("btnSaveConfig").addEventListener("click", function() { saveConfig(); log("Settings saved."); });
    document.getElementById("btnResetConfig").addEventListener("click", function() {
        localStorage.removeItem("auto_heads_config_v10");
        appConfig.characters = [];
        appConfig.silenceTrim = true;
        appConfig.silenceThreshold = -45;
        appConfig.useAI = true;
        appConfig.fillGaps = false;
        appConfig.applyPresets = true;
        appConfig.motionPop = true;
        appConfig.minimumExpressionDuration = 1.0;
        appConfig.maximumExpressionDuration = 4.0;
        renderTracks();
        syncTracks();
    });

    document.getElementById("btnBrowsePresetA").addEventListener("click", function() {
        hostCall("choosePresetFile", "Select Preset A", function(path) {
            if (path) { appConfig.presetA = path.replace(/\\/g,"/"); renderTracks(); }
        }, 30000);
    });

    document.getElementById("btnBrowsePresetB").addEventListener("click", function() {
        hostCall("choosePresetFile", "Select Preset B", function(path) {
            if (path) { appConfig.presetB = path.replace(/\\/g,"/"); renderTracks(); }
        }, 30000);
    });

    // Character manager wiring
    renderHeadsCharacters();
    var btnCreateCharacter = document.getElementById("btnCreateCharacter");
    if (btnCreateCharacter) btnCreateCharacter.addEventListener("click", function() {
        var nameInput = document.getElementById("txtNewCharacterName");
        var name = nameInput ? nameInput.value.trim() : "";
        if (!name) { log("Enter a character name first."); return; }
        if (findCharacter(name)) { log("Character \"" + name + "\" already exists."); return; }
        headsCharacters.push({ name: name, images: [] });
        saveCharacters(); renderHeadsCharacters(); renderTracks();
        openCharacterEditor(name);
        if (nameInput) nameInput.value = "";
        log("Created character \"" + name + "\". Now drop in head images and tag them.");
    });

    var btnBrowseHeadImages = document.getElementById("btnBrowseHeadImages");
    if (btnBrowseHeadImages) btnBrowseHeadImages.addEventListener("click", function() {
        var picker = document.getElementById("fileHeadPicker");
        if (picker) picker.click();
    });

    var fileHeadPicker = document.getElementById("fileHeadPicker");
    if (fileHeadPicker) fileHeadPicker.addEventListener("change", function() {
        var paths = [];
        for (var i = 0; i < fileHeadPicker.files.length; i++) { paths.push(fileHeadPicker.files[i].path || fileHeadPicker.files[i].name); }
        importHeadImages(paths);
        fileHeadPicker.value = "";
    });

    var headDropZone = document.getElementById("headDropZone");
    if (headDropZone) {
        headDropZone.addEventListener("dragover", function(e) { e.preventDefault(); headDropZone.classList.add("dragover"); });
        headDropZone.addEventListener("dragleave", function(e) { headDropZone.classList.remove("dragover"); });
        headDropZone.addEventListener("drop", function(e) {
            e.preventDefault(); headDropZone.classList.remove("dragover");
            var paths = [];
            var files = e.dataTransfer.files;
            for (var i = 0; i < files.length; i++) { if (files[i].path) paths.push(files[i].path); }
            importHeadImages(paths);
        });
    }

    // SFX Library Events
    var sfxListContainer = document.getElementById("sfxLibraryContainer");
    if (sfxListContainer) {
        sfxListContainer.addEventListener("click", function(e) {
            var btn = e.target.closest("button");
            if (!btn) return;
            var action = btn.getAttribute("data-action");
            var idx = parseInt(btn.getAttribute("data-index"), 10);
            if (action === "play") {
                playSfxPreview(idx);
            } else if (action === "edit") {
                openTrimmerModal(sfxLibrary[idx]);
            } else if (action === "delete") {
                sfxLibrary.splice(idx, 1);
                saveSfxState();
                renderSfxLibrary();
                logSFX("Removed sound effect.");
            }
        });

        sfxListContainer.addEventListener("change", function(e) {
            if (e.target.getAttribute("data-action") === "tag") {
                var idx = parseInt(e.target.getAttribute("data-index"), 10);
                if (sfxLibrary[idx]) {
                    sfxLibrary[idx].tag = e.target.value;
                    saveSfxState();
                    logSFX("Updated tag for " + sfxLibrary[idx].name + " to " + e.target.value);
                }
            }
        });
    }

    var fileAudioPicker = document.getElementById("fileAudioPicker");
    if (fileAudioPicker) {
        fileAudioPicker.addEventListener("change", function(e) {
            var files = e.target.files;
            if (!files || !files.length) return;
            var addedCount = 0;
            for (var fIndex = 0; fIndex < files.length; fIndex++) {
                var fl = files[fIndex];
                var fPath = fl.path ? fl.path.replace(/\\/g, "/") : fl.name;
                var cleanName = fl.name;
                var tag = "shocked / dramatic";
                var low = cleanName.toLowerCase();
                if (low.indexOf("bruh") !== -1 || low.indexOf("fail") !== -1 || low.indexOf("awkward") !== -1 || low.indexOf("laugh") !== -1) tag = "funny / awkward";
                else if (low.indexOf("horn") !== -1 || low.indexOf("cheer") !== -1 || low.indexOf("hype") !== -1 || low.indexOf("win") !== -1) tag = "exciting / hype";
                else if (low.indexOf("sad") !== -1 || low.indexOf("violin") !== -1 || low.indexOf("cry") !== -1) tag = "sad / defeat";
                else if (low.indexOf("pipe") !== -1 || low.indexOf("punch") !== -1 || low.indexOf("hit") !== -1 || low.indexOf("boom") !== -1) tag = "impact / action";

                sfxLibrary.push({
                    id: "sfx_" + Date.now() + "_" + fIndex,
                    name: cleanName,
                    tag: tag,
                    duration: 1.5,
                    path: fPath
                });
                addedCount++;
            }
            saveSfxState();
            renderSfxLibrary();
            logSFX("Added " + addedCount + " sound effect(s).");
            fileAudioPicker.value = "";
        });
    }

    var btnAddSfx = document.getElementById("btnAddSfxFile");
    if (btnAddSfx) {
        btnAddSfx.addEventListener("click", function() {
            // First open native Premiere audio picker with audio filter (*.wav, *.mp3, etc.)
            hostCall("chooseAudioFile", "Select Sound Effect Audio (.wav/.mp3)", function(path) {
                if (path && path !== "null") {
                    var clean = path.replace(/\\/g, "/");
                    var name = clean.substring(clean.lastIndexOf("/") + 1);
                    var tag = "shocked / dramatic";
                    var low = name.toLowerCase();
                    if (low.indexOf("bruh") !== -1 || low.indexOf("fail") !== -1 || low.indexOf("awkward") !== -1) tag = "funny / awkward";
                    else if (low.indexOf("horn") !== -1 || low.indexOf("cheer") !== -1 || low.indexOf("hype") !== -1) tag = "exciting / hype";
                    else if (low.indexOf("sad") !== -1 || low.indexOf("violin") !== -1) tag = "sad / defeat";
                    else if (low.indexOf("pipe") !== -1 || low.indexOf("punch") !== -1 || low.indexOf("hit") !== -1) tag = "impact / action";

                    sfxLibrary.push({
                        id: "sfx_" + Date.now(),
                        name: name,
                        tag: tag,
                        duration: 1.5,
                        path: clean
                    });
                    saveSfxState();
                    renderSfxLibrary();
                    logSFX("Added sound effect: " + name);
                } else if (fileAudioPicker) {
                    fileAudioPicker.click();
                }
            }, 30000);
        });
    }

    var btnImportFolder = document.getElementById("btnImportSfxFolder");
    if (btnImportFolder) {
        btnImportFolder.addEventListener("click", function() {
            hostCall("chooseFolder", "Select Sound Effects Folder", function(folderPath) {
                if (folderPath && folderPath !== "null") {
                    var cleanFolder = folderPath.replace(/\\/g, "/");
                    logSFX("Scanning folder: " + cleanFolder + "...");
                    hostCall("scanAudioFilesFromFolder", cleanFolder, function(rawFiles) {
                        var fileList = [];
                        try { fileList = JSON.parse(rawFiles || "[]"); } catch(e) {}
                        if (fileList && fileList.length) {
                            var added = 0;
                            fileList.forEach(function(item) {
                                var tag = "shocked / dramatic";
                                var low = item.name.toLowerCase();
                                if (low.indexOf("bruh") !== -1 || low.indexOf("fail") !== -1 || low.indexOf("awkward") !== -1) tag = "funny / awkward";
                                else if (low.indexOf("horn") !== -1 || low.indexOf("cheer") !== -1 || low.indexOf("hype") !== -1) tag = "exciting / hype";
                                else if (low.indexOf("sad") !== -1 || low.indexOf("violin") !== -1) tag = "sad / defeat";
                                else if (low.indexOf("pipe") !== -1 || low.indexOf("punch") !== -1 || low.indexOf("hit") !== -1) tag = "impact / action";

                                sfxLibrary.push({
                                    id: "sfx_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
                                    name: item.name,
                                    tag: tag,
                                    duration: 1.5,
                                    path: item.path
                                });
                                added++;
                            });
                            saveSfxState();
                            renderSfxLibrary();
                            logSFX("Imported " + added + " audio file(s) from " + cleanFolder);
                        } else {
                            logSFX("No audio files (.wav, .mp3, .ogg, .flac) found in: " + cleanFolder);
                        }
                    }, 30000);
                }
            }, 30000);
        });
    }

    var rngPop = document.getElementById("rngPopulationRate");
    if (rngPop) {
        rngPop.addEventListener("input", function(e) {
            updatePopulationLabel(parseInt(e.target.value, 10));
            saveSfxState();
        });
    }

    var btnSaveSfx = document.getElementById("btnSaveSfxConfig");
    if (btnSaveSfx) {
        btnSaveSfx.addEventListener("click", function() {
            saveSfxState();
            logSFX("SFX configuration and library saved.");
        });
    }

    var btnResetSfx = document.getElementById("btnResetSfxDefaults");
    if (btnResetSfx) {
        btnResetSfx.addEventListener("click", function() {
            localStorage.removeItem("opencut_sfx_library_v2");
            localStorage.removeItem("opencut_sfx_config_v2");
            loadSfxState();
            logSFX("Reset SFX library to default pack.");
        });
    }

    var btnRunSfxEl = document.getElementById("btnRunSFX");
    if (btnRunSfxEl) btnRunSfxEl.addEventListener("click", startSfxRun);

    // Trimmer Modal Controls
    var btnCloseTrimmer = document.getElementById("btnCloseTrimmer");
    if (btnCloseTrimmer) btnCloseTrimmer.addEventListener("click", closeTrimmerModal);

    var btnCancelTrim = document.getElementById("btnCancelTrim");
    if (btnCancelTrim) btnCancelTrim.addEventListener("click", closeTrimmerModal);

    var btnAuditionTrim = document.getElementById("btnAuditionTrim");
    if (btnAuditionTrim) btnAuditionTrim.addEventListener("click", playTrimmedAudition);

    var btnSaveTrim = document.getElementById("btnSaveTrim");
    if (btnSaveTrim) btnSaveTrim.addEventListener("click", saveTrimAndReplace);

    // Trimmer Handle Dragging
    var handleInEl = document.getElementById("handleIn");
    var handleOutEl = document.getElementById("handleOut");
    var overlayEl = document.getElementById("trimHandlesOverlay");

    if (handleInEl) {
        handleInEl.addEventListener("mousedown", function(e) {
            isDraggingHandle = "in";
            e.preventDefault();
        });
    }

    if (handleOutEl) {
        handleOutEl.addEventListener("mousedown", function(e) {
            isDraggingHandle = "out";
            e.preventDefault();
        });
    }

    window.addEventListener("mousemove", function(e) {
        if (!isDraggingHandle || !overlayEl || trimmerDuration <= 0) return;
        var rect = overlayEl.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var pct = Math.max(0, Math.min(1, x / rect.width));
        var targetSec = pct * trimmerDuration;

        if (isDraggingHandle === "in") {
            trimmerInSec = Math.max(0, Math.min(targetSec, trimmerOutSec - 0.05));
        } else if (isDraggingHandle === "out") {
            trimmerOutSec = Math.max(trimmerInSec + 0.05, Math.min(trimmerDuration, targetSec));
        }
        updateTrimHandlePositions();
    });

    window.addEventListener("mouseup", function() {
        isDraggingHandle = null;
    });

    // Keyboard shortcuts & initial view
    document.addEventListener("keydown", function(event) {
        if (event.key === "F10") {
            event.preventDefault();
            setDebugVisible(!deepConsoleVisible);
        }
    });

    // AI Voice Actions
    var btnAIVoiceOneClick = document.getElementById("btnAIVoiceOneClick");
    if (btnAIVoiceOneClick) btnAIVoiceOneClick.addEventListener("click", oneClickAutoAIVoice);

    var btnAIVoicePrep = document.getElementById("btnAIVoicePrep");
    if (btnAIVoicePrep) btnAIVoicePrep.addEventListener("click", prepAIVoiceTrack);

    var btnAIVoiceAutoGenerate = document.getElementById("btnAIVoiceAutoGenerate");
    if (btnAIVoiceAutoGenerate) btnAIVoiceAutoGenerate.addEventListener("click", autoGenerateAIVoiceTrack);

    var btnAIVoiceResync = document.getElementById("btnAIVoiceResync");
    if (btnAIVoiceResync) btnAIVoiceResync.addEventListener("click", resyncAIVoiceTrack);

    // ElevenLabs Settings Persistence
    var apiKeyEl = document.getElementById("txtElevenLabsApiKey");
    var voiceEl = document.getElementById("selElevenLabsVoice");
    if (apiKeyEl) {
        try {
            var savedKey = localStorage.getItem("elevenlabs_api_key");
            if (savedKey) apiKeyEl.value = savedKey;
        } catch(e) {}
        apiKeyEl.addEventListener("input", function() {
            try { localStorage.setItem("elevenlabs_api_key", apiKeyEl.value.trim()); } catch(e) {}
        });
        apiKeyEl.addEventListener("change", function() {
            try { localStorage.setItem("elevenlabs_api_key", apiKeyEl.value.trim()); } catch(e) {}
        });
    }
    if (voiceEl) {
        try {
            var savedVoice = localStorage.getItem("elevenlabs_selected_voice");
            if (savedVoice) voiceEl.value = savedVoice;
        } catch(e) {}
        voiceEl.addEventListener("change", function() {
            try { localStorage.setItem("elevenlabs_selected_voice", voiceEl.value); } catch(e) {}
        });
    }

    setupAIVoiceDropZone();

    // AutoCut Silences Listeners
    var btnSilencesScopeEntire = document.getElementById("btnSilencesScopeEntire");
    if (btnSilencesScopeEntire) btnSilencesScopeEntire.addEventListener("click", function() { setSilencesScope("entire"); });

    var btnSilencesScopeInOut = document.getElementById("btnSilencesScopeInOut");
    if (btnSilencesScopeInOut) btnSilencesScopeInOut.addEventListener("click", function() { setSilencesScope("inout"); });

    var btnSilencesValidate = document.getElementById("btnSilencesValidate");
    if (btnSilencesValidate) btnSilencesValidate.addEventListener("click", function() { goToSilencesStep(2); });

    var stepPillSections = document.getElementById("stepPillSections");
    if (stepPillSections) stepPillSections.addEventListener("click", function() { goToSilencesStep(1); });

    var stepPillSettings = document.getElementById("stepPillSettings");
    if (stepPillSettings) stepPillSettings.addEventListener("click", function() { goToSilencesStep(2); });

    var rngSilenceThreshold = document.getElementById("rngSilenceThreshold");
    if (rngSilenceThreshold) {
        rngSilenceThreshold.addEventListener("input", function() {
            var lbl = document.getElementById("lblSilenceThreshold");
            if (lbl) lbl.textContent = rngSilenceThreshold.value + "db";
        });
    }

    var btnSilencesCalcThreshold = document.getElementById("btnSilencesCalcThreshold");
    if (btnSilencesCalcThreshold) btnSilencesCalcThreshold.addEventListener("click", calculateAIThreshold);

    document.querySelectorAll(".preset-pill").forEach(function(pill) {
        pill.addEventListener("click", function() {
            var pr = pill.dataset.preset;
            if (pr) applySilencePreset(pr);
        });
    });

    var btnSilencesPreviewFast = document.getElementById("btnSilencesPreviewFast");
    if (btnSilencesPreviewFast) btnSilencesPreviewFast.addEventListener("click", function() {
        executeAutoCutSilencesPreview(true);
    });

    var btnSilencesPreviewFull = document.getElementById("btnSilencesPreviewFull");
    if (btnSilencesPreviewFull) btnSilencesPreviewFull.addEventListener("click", function() {
        executeAutoCutSilencesPreview(false);
    });

    var btnSilencesExecute = document.getElementById("btnSilencesExecute");
    if (btnSilencesExecute) btnSilencesExecute.addEventListener("click", executeAutoCutSilences);

    // AutoPOV Listeners
    var btnPOVScopeEntire = document.getElementById("btnPOVScopeEntire");
    if (btnPOVScopeEntire) btnPOVScopeEntire.addEventListener("click", function() { setPOVScope("entire"); });
    var btnPOVScopeInOut = document.getElementById("btnPOVScopeInOut");
    if (btnPOVScopeInOut) btnPOVScopeInOut.addEventListener("click", function() { setPOVScope("inout"); });
    var btnPOVValidate = document.getElementById("btnPOVValidate");
    if (btnPOVValidate) btnPOVValidate.addEventListener("click", function() { goToPOVStep(2); });
    var povPillSections = document.getElementById("povStepPillSections");
    if (povPillSections) povPillSections.addEventListener("click", function() { goToPOVStep(1); });
    var povPillSpeakers = document.getElementById("povStepPillSpeakers");
    if (povPillSpeakers) povPillSpeakers.addEventListener("click", function() { goToPOVStep(2); });
    var btnPOVAddSpeaker = document.getElementById("btnPOVAddSpeaker");
    if (btnPOVAddSpeaker) btnPOVAddSpeaker.addEventListener("click", addPOVSpeaker);
    var btnPOVAddPov = document.getElementById("btnPOVAddPov");
    if (btnPOVAddPov) btnPOVAddPov.addEventListener("click", addPOVPov);
    var btnPOVExecute = document.getElementById("btnPOVExecute");
    if (btnPOVExecute) btnPOVExecute.addEventListener("click", executeAutoPOV);

    // AutoSeparate Listeners
    var btnSepScopeEntire = document.getElementById("btnSepScopeEntire");
    if (btnSepScopeEntire) btnSepScopeEntire.addEventListener("click", function() { setSepScope("entire"); });
    var btnSepScopeInOut = document.getElementById("btnSepScopeInOut");
    if (btnSepScopeInOut) btnSepScopeInOut.addEventListener("click", function() { setSepScope("inout"); });
    var btnSepAnalyze = document.getElementById("btnSepAnalyze");
    if (btnSepAnalyze) btnSepAnalyze.addEventListener("click", analyzeSepSpeakers);
    var btnSepExecute = document.getElementById("btnSepExecute");
    if (btnSepExecute) btnSepExecute.addEventListener("click", executeSepSeparate);
    var btnSepBack = document.getElementById("btnSepBack");
    if (btnSepBack) btnSepBack.addEventListener("click", function() { goToSepStep(1); });
    var rngSepThreshold = document.getElementById("rngSepThreshold");
    if (rngSepThreshold) rngSepThreshold.addEventListener("input", function() {
        var lbl = document.getElementById("lblSepThreshold");
        if (lbl) lbl.textContent = rngSepThreshold.value + "db";
        separateState.threshold = parseFloat(rngSepThreshold.value);
    });
    var btnSepReAnalyze = document.getElementById("btnSepReAnalyze");
    if (btnSepReAnalyze) btnSepReAnalyze.addEventListener("click", function() {
        goToSepStep(1);
        analyzeSepSpeakers();
    });

    setDebugVisible(false);

    var savedView = "hub";
    try { savedView = localStorage.getItem("opencut_active_view") || "hub"; } catch(e) {}
    switchView(savedView);

    var processCancelBtn = document.getElementById("processCancel");
    if (processCancelBtn) processCancelBtn.addEventListener("click", function() {
        if (processOverlayState.feature === "heads") {
            var cBtn = document.getElementById("btnCancel");
            if (cBtn && !cBtn.disabled) {
                cBtn.click();
                finishProcessOverlay(false, "cancelled by user.");
                return;
            }
        }
        hideProcessOverlay();
    });
});

// ============================================================
// SHARED PROCESS OVERLAY CONTROLLER
// One blurred-backdrop, Consolas, opencut-branded task dialog for
// every feature (heads / sfx / aivoice / silences).
// ============================================================

var PROCESS_OVERLAY_FEATURES = {
    heads: {
        title: "auto character heads",
        steps: [
            "connecting to premiere",
            "reading timeline cuts",
            "starting local ai",
            "transcribing dialogue",
            "matching expressions to dialogue",
            "trimming dead air",
            "placing head clips on timeline",
            "finalizing & verifying"
        ]
    },
    sfx: {
        title: "auto sound effects",
        steps: [
            "connecting to premiere",
            "reading timeline clips",
            "transcribing dialogue",
            "predicting punchlines",
            "leveling sound effects",
            "placing sfx on timeline",
            "finalizing & verifying"
        ]
    },
    aivoice: {
        title: "auto ai voice",
        steps: [
            "rendering voice track from timeline",
            "condensing dialogue",
            "converting with elevenlabs",
            "importing ai audio track",
            "syncing clips to waveform",
            "finalizing & verifying"
        ]
    },
    pov: {
        title: "autopov",
        steps: [
            "scanning timeline tracks",
            "decoding speaker audio",
            "detecting who is speaking",
            "razoring & switching povs",
            "finalizing & verifying"
        ]
    },
    separate: {
        title: "autoseparate",
        steps: [
            "rendering source audio",
            "detecting speech segments",
            "extracting speaker fingerprints",
            "clustering voices",
            "separating onto tracks",
            "finalizing & verifying"
        ]
    },
    silences: {
        title: "autocut silences",
        steps: [
            "scanning timeline tracks",
            "decoding audio from source files",
            "detecting silence intervals",
            "razoring & removing silences",
            "snapping gaps & verifying timeline"
        ]
    }
};

var processOverlayState = { feature: null, currentStep: -1, visible: false };

function showProcessOverlay(featureKey, subtitle) {
    var def = PROCESS_OVERLAY_FEATURES[featureKey];
    var ov = document.getElementById("processOverlay");
    if (!def || !ov) return;

    processOverlayState.feature = featureKey;
    processOverlayState.currentStep = 0;
    processOverlayState.visible = true;

    var title = document.getElementById("processTitle");
    if (title) title.textContent = def.title;
    var sub = document.getElementById("processSub");
    if (sub) sub.textContent = subtitle || "working on your timeline…";

    var stepsEl = document.getElementById("processSteps");
    if (stepsEl) {
        stepsEl.innerHTML = "";
        def.steps.forEach(function(label, idx) {
            var row = document.createElement("div");
            row.className = "proc-step" + (idx === 0 ? " active" : "");
            row.dataset.step = idx;
            row.innerHTML = '<span class="proc-pip">' + (idx + 1) + '</span><span class="proc-label">' + label + '</span>';
            stepsEl.appendChild(row);
        });
    }

    var cancelBtn = document.getElementById("processCancel");
    if (cancelBtn) cancelBtn.textContent = "cancel process";

    ov.classList.remove("hidden");
}

function advanceProcessStep(idx) {
    if (!processOverlayState.visible) return;
    var stepsEl = document.getElementById("processSteps");
    if (!stepsEl) return;
    var rows = stepsEl.children;
    if (idx < 0) idx = 0;
    if (idx > rows.length - 1) idx = rows.length - 1;
    if (idx < processOverlayState.currentStep) return; // never go backwards
    processOverlayState.currentStep = idx;
    for (var i = 0; i < rows.length; i++) {
        rows[i].classList.remove("active", "done");
        var pip = rows[i].querySelector(".proc-pip");
        if (i < idx) {
            rows[i].classList.add("done");
            if (pip) pip.textContent = "✓";
        } else if (i === idx) {
            rows[i].classList.add("active");
            if (pip) pip.textContent = (i + 1);
        } else {
            if (pip) pip.textContent = (i + 1);
        }
    }
}

function setProcessOverlaySubtitle(text) {
    var sub = document.getElementById("processSub");
    if (sub) sub.textContent = text;
}

function finishProcessOverlay(success, message) {
    if (!processOverlayState.visible) return;
    var stepsEl = document.getElementById("processSteps");
    if (stepsEl) {
        var rows = stepsEl.children;
        for (var i = 0; i < rows.length; i++) {
            rows[i].classList.remove("active");
            if (success) {
                rows[i].classList.add("done");
                var pip = rows[i].querySelector(".proc-pip");
                if (pip) pip.textContent = "✓";
            } else {
                if (!rows[i].classList.contains("done")) {
                    rows[i].classList.add("active");
                }
            }
        }
    }
    setProcessOverlaySubtitle(message || (success ? "done." : "stopped."));
    var cancelBtn = document.getElementById("processCancel");
    if (cancelBtn) cancelBtn.textContent = "close";
    if (success) {
        setTimeout(hideProcessOverlay, 2600);
    }
}

function hideProcessOverlay() {
    processOverlayState.visible = false;
    processOverlayState.feature = null;
    processOverlayState.currentStep = -1;
    var ov = document.getElementById("processOverlay");
    if (ov) ov.classList.add("hidden");
}

// Heads progress hook: maps the existing setProgress() pipeline onto overlay steps.
function updateHeadsOverlayStep(percent, title) {
    if (!processOverlayState.visible || processOverlayState.feature !== "heads") return;
    var t = (title || "").toLowerCase();
    var step;
    if (t.indexOf("placing") !== -1) step = 6;
    else if (t.indexOf("trimming") !== -1) step = 5;
    else if (t.indexOf("preparing placement") !== -1 || percent >= 78) step = 4;
    else if (t.indexOf("analyzing") !== -1 || (t.indexOf("analysis") !== -1)) step = (percent >= 45 ? 3 : 3);
    else if (t.indexOf("starting local") !== -1) step = 2;
    else if (t.indexOf("reading") !== -1) step = 1;
    else step = 0;
    advanceProcessStep(step);
}
