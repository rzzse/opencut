#target premierepro

var AUTO_HEAD_FIXED_FOLDERS = [];

function chooseFolder(characterName) {
    var folder = Folder.selectDialog("Select head PNG folder for " + characterName);
    return folder ? folder.fsName : "";
}

function choosePresetFile(title) {
    var file = File.openDialog(title, "Premiere preset:*.prfpset");
    return file ? file.fsName : "";
}

function chooseAudioFile(title) {
    var filter = "Audio files:*.wav;*.mp3;*.ogg;*.flac;*.m4a;*.aif;*.aiff;All files:*.*";
    var file = File.openDialog(title || "Select Sound Effect Audio (.wav/.mp3)", filter);
    return file ? file.fsName : "";
}

function scanAudioFilesFromFolder(folderPath) {
    var result = [];
    try {
        var folder = new Folder(folderPath);
        if (folder && folder.exists) {
            var files = folder.getFiles();
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (f instanceof File) {
                    var ext = f.name.substring(f.name.lastIndexOf(".")).toLowerCase();
                    if (ext === ".wav" || ext === ".mp3" || ext === ".ogg" || ext === ".flac" || ext === ".m4a" || ext === ".aif" || ext === ".aiff") {
                        result.push({
                            name: f.name,
                            path: f.fsName.replace(/\\/g, "/")
                        });
                    }
                }
            }
        }
    } catch (e) {}
    return JSON.stringify(result);
}

function getExtensionPath() {
    try {
        // $.fileName is this JSX file: <extension>/jsx/hostscript.jsx.
        return new File($.fileName).parent.parent.fsName;
    } catch (error) { return "ERR: " + error; }
}

function getRuntimeFolder() {
    try {
        var folder = new Folder(Folder.temp.fsName + "/OpenCut");
        if (!folder.exists) folder.create();
        return folder.fsName;
    } catch (error) { return "ERR: " + error; }
}

function getHostStatus() {
    var result = { error: null, sequenceName: "", audioTracks: 0, videoTracks: 0, activeSequence: false };
    try {
        var sequence = app.project.activeSequence;
        if (!sequence) throw new Error("Open and activate a Premiere sequence first.");
        result.activeSequence = true;
        result.sequenceName = sequence.name;
        result.audioTracks = sequence.audioTracks.numTracks;
        result.videoTracks = sequence.videoTracks.numTracks;
    } catch (error) { result.error = error.toString(); }
    return JSON.stringify(result);
}

function getTimelineStatus() {
    return getHostStatus();
}

function checkFileExists(filePath) {
    var file = new File(filePath);
    return file.exists && file.length > 2 ? "true" : "false";
}

function readTextFile(filePath) {
    try {
        var file = new File(filePath);
        file.encoding = "UTF-8";
        if (!file.exists || !file.open("r")) return "ERR_NO_FILE";
        var text = file.read();
        file.close();
        return text;
    } catch (error) { return "ERR: " + error; }
}

function writeTextFile(argumentJson) {
    try {
        var argument = JSON.parse(argumentJson);
        var file = new File(argument.path);
        file.encoding = "UTF-8";
        if (!file.open("w")) return "Could not open " + file.fsName;
        file.write(argument.text);
        file.close();
        return "OK";
    } catch (error) { return "ERR: " + error; }
}

function copyFilesToFolder(paramsJson) {
    try {
        var params = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
        var destFolder = params.folder;
        var files = params.files || [];
        
        var folder = new Folder(destFolder);
        if (!folder.exists) folder.create();
        
        var results = [];
        for (var i = 0; i < files.length; i++) {
            var srcFile = new File(files[i]);
            if (!srcFile.exists) {
                results.push({ success: false, src: files[i], error: "Source file does not exist" });
                continue;
            }
            var destFile = new File(destFolder + "/" + srcFile.name);
            if (destFile.exists) destFile.remove();
            if (srcFile.copy(destFile.fsName)) {
                results.push({ success: true, src: files[i], dest: destFile.fsName });
            } else {
                results.push({ success: false, src: files[i], error: "Copy failed" });
            }
        }
        return JSON.stringify({ success: true, results: results });
    } catch (error) {
        return JSON.stringify({ success: false, error: error.toString() });
    }
}

function runBatchScript(argumentJson) {
    try {
        var argument = JSON.parse(argumentJson);
        var batch = new File(Folder.temp.fsName + "/OpenCut_Run.bat");
        if (!batch.open("w")) return "Could not create batch file";
        batch.writeln("@echo off");
        batch.writeln("set PYTHONIOENCODING=utf-8");
        batch.writeln("chcp 65001 >nul");
        if (argument.logPath) {
            batch.writeln("\"" + argument.python + "\" \"" + argument.script + "\" \"" + argument.request + "\" \"" + argument.output + "\" > \"" + argument.logPath + "\" 2>&1");
        } else {
            batch.writeln("\"" + argument.python + "\" \"" + argument.script + "\" \"" + argument.request + "\" \"" + argument.output + "\"");
        }
        batch.close();
        batch.execute();
        return "OK";
    } catch (error) { return "ERR: " + error; }
}

function getSequenceTracks() {
    var result = { error: null, sequenceName: "", tracks: [] };
    try {
        var sequence = app.project.activeSequence;
        if (!sequence) throw new Error("Open and activate a Premiere sequence first.");
        result.sequenceName = sequence.name;
        for (var index = 0; index < sequence.audioTracks.numTracks; index++) {
            var track = sequence.audioTracks[index];
            result.tracks.push({ index: index, trackNum: index + 1, name: track.name || "Audio " + (index + 1), clipCount: track.clips.numItems });
        }
    } catch (error) { result.error = error.toString(); }
    return JSON.stringify(result);
}

function getTimelineAudioClips(configJson) {
    var result = { error: null, clips: [] };
    try {
        var config = JSON.parse(configJson);
        var sequence = app.project.activeSequence;
        if (!sequence) throw new Error("Open and activate a Premiere sequence first.");
        var minimumDuration = 0.05;
        for (var trackIndex = 0; trackIndex < sequence.audioTracks.numTracks; trackIndex++) {
            var audioTrack = sequence.audioTracks[trackIndex];
            for (var clipIndex = 0; clipIndex < audioTrack.clips.numItems; clipIndex++) {
                var clip = audioTrack.clips[clipIndex];
                var start = clip.start.seconds;
                var end = clip.end.seconds;
                if (end - start < minimumDuration) continue;
                var mediaPath = "";
                var sourceIn = 0;
                try { mediaPath = clip.projectItem.getMediaPath(); } catch (ignoredPath) {}
                try { sourceIn = clip.inPoint.seconds; } catch (ignoredIn) {}
                result.clips.push({ trackIndex: trackIndex, start: start, end: end, inPoint: sourceIn, clipName: clip.name || "", mediaPath: mediaPath });
            }
        }
    } catch (error) { result.error = error.toString(); }
    return JSON.stringify(result);
}

function autoHeadsRazorAudioAt(sequence, qeTrack, seconds) {
    var cutTime = new Time();
    cutTime.seconds = seconds;
    var timecode = "";
    try {
        var settings = sequence.getSettings();
        timecode = cutTime.getFormatted(settings.videoFrameRate, sequence.videoDisplayFormat);
    } catch (formatError) {
        try {
            sequence.setPlayerPosition(cutTime.ticks.toString());
            timecode = qe.project.getActiveSequence().CTI.timecode;
        } catch(eQe) {
            var totalSec = Math.max(0, seconds);
            var hrs = Math.floor(totalSec / 3600);
            var rem = totalSec % 3600;
            var mins = Math.floor(rem / 60);
            var s = Math.floor(rem % 60);
            var frames = Math.floor((rem % 1) * 30);
            function pad(n) { return (n < 10 ? "0" : "") + n; }
            timecode = pad(hrs) + ":" + pad(mins) + ":" + pad(s) + ":" + pad(frames);
        }
    }
    if (!timecode || typeof qeTrack.razor !== "function") throw new Error("Premiere audio razor is unavailable.");
    qeTrack.razor(timecode);
}

function trimTimelineAudioClips(planJson) {
    var result = { error: null, trimmedCount: 0, removedCount: 0, razorCount: 0, razorFailures: 0 };
    try {
        var data = JSON.parse(planJson);
        var sequence = app.project.activeSequence;
        if (!sequence) throw new Error("Open and activate a Premiere sequence first.");
        var trimOps = data.trimOps || [];
        if (!trimOps.length) return JSON.stringify(result);
        app.enableQE();
        var qeSequence = qe.project.getActiveSequence();

        var opsByTrack = {};
        for (var i = 0; i < trimOps.length; i++) {
            var tIdx = parseInt(trimOps[i].trackIndex, 10);
            if (!opsByTrack[tIdx]) opsByTrack[tIdx] = [];
            opsByTrack[tIdx].push(trimOps[i]);
        }

        for (var trackIndexStr in opsByTrack) {
            var trackIndex = parseInt(trackIndexStr, 10);
            if (trackIndex < 0 || trackIndex >= sequence.audioTracks.numTracks) continue;
            var audioTrack = sequence.audioTracks[trackIndex];
            var ops = opsByTrack[trackIndex];
            ops.sort(function(a, b) { return parseFloat(b.origStart) - parseFloat(a.origStart); });
            var qeTrack = typeof qeSequence.getAudioTrackAt === "function" ? qeSequence.getAudioTrackAt(trackIndex) : qeSequence.getAudioTrack(trackIndex);

            for (var opIdx = 0; opIdx < ops.length; opIdx++) {
                var op = ops[opIdx];
                var origStart = parseFloat(op.origStart);
                var origEnd = parseFloat(op.origEnd || op.origStart);
                var targetClip = null;
                var bestDiff = 0.25;
                for (var c = 0; c < audioTrack.clips.numItems; c++) {
                    var tc = audioTrack.clips[c];
                    var diff = Math.abs(tc.start.seconds - origStart);
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        targetClip = tc;
                    }
                }
                if (!targetClip) continue;

                if (op.remove) {
                    try {
                        targetClip.remove(0, 0);
                        result.removedCount++;
                    } catch (eRemove) {
                        try {
                            targetClip.remove(false, false);
                            result.removedCount++;
                        } catch (eR2) {}
                    }
                    continue;
                }

                var keepRanges = op.keepRanges || [];
                var didRazor = false;
                if (keepRanges.length > 0 && qeTrack && typeof qeTrack.razor === "function") {
                    try {
                        var cuts = [];
                        for (var kr = 0; kr < keepRanges.length; kr++) {
                            var ks = parseFloat(keepRanges[kr].start);
                            var ke = parseFloat(keepRanges[kr].end);
                            if (ks > origStart + 0.02 && ks < origEnd - 0.02) cuts.push(ks);
                            if (ke > origStart + 0.02 && ke < origEnd - 0.02) cuts.push(ke);
                        }
                        cuts.sort(function(a, b) { return a - b; });

                        for (var ci = 0; ci < cuts.length; ci++) {
                            try {
                                autoHeadsRazorAudioAt(sequence, qeTrack, cuts[ci]);
                                result.razorCount++;
                                didRazor = true;
                            } catch (eRazor) {
                                result.razorFailures++;
                            }
                        }

                        if (didRazor) {
                            var piecesToDelete = [];
                            for (var p = 0; p < audioTrack.clips.numItems; p++) {
                                var piece = audioTrack.clips[p];
                                if (piece.start.seconds >= origStart - 0.05 && piece.end.seconds <= origEnd + 0.05) {
                                    var mid = (piece.start.seconds + piece.end.seconds) / 2.0;
                                    var insideKeep = false;
                                    for (var k = 0; k < keepRanges.length; k++) {
                                        if (mid >= parseFloat(keepRanges[k].start) - 0.02 && mid <= parseFloat(keepRanges[k].end) + 0.02) {
                                            insideKeep = true;
                                            break;
                                        }
                                    }
                                    if (!insideKeep) {
                                        piecesToDelete.push(piece);
                                    }
                                }
                            }

                            for (var d = piecesToDelete.length - 1; d >= 0; d--) {
                                try {
                                    piecesToDelete[d].remove(0, 0);
                                    result.removedCount++;
                                } catch (eDelPiece) {
                                    try { piecesToDelete[d].remove(false, false); } catch (eDel2) {}
                                }
                            }
                            result.trimmedCount++;
                        }
                    } catch (eRazorFlow) {}
                }

                if (!didRazor && !isNaN(op.newStart) && !isNaN(op.newEnd)) {
                    try {
                        if (!isNaN(op.newInPoint) && targetClip.inPoint) {
                            targetClip.inPoint.seconds = parseFloat(op.newInPoint);
                        }
                        targetClip.start.seconds = parseFloat(op.newStart);
                        targetClip.end.seconds = parseFloat(op.newEnd);
                        result.trimmedCount++;
                    } catch (eInPlace) {}
                }
            }
        }
    } catch (error) {
        result.error = error.toString();
    }
    return JSON.stringify(result);
}

function autoHeadsNormalPath(path) {
    return String(path || "").replace(/\\/g, "/").toLowerCase();
}

function autoHeadsIsFixedFolderPath(trackIndex, headPath) {
    if (trackIndex < 0 || trackIndex >= AUTO_HEAD_FIXED_FOLDERS.length) return true;
    var requiredFolder = autoHeadsNormalPath(new Folder(AUTO_HEAD_FIXED_FOLDERS[trackIndex]).fsName);
    var actualPath = autoHeadsNormalPath(new File(headPath).fsName);
    return actualPath.indexOf(requiredFolder + "/") === 0;
}

function autoHeadsIsManagedTimelineClip(clip) {
    try {
        if (clip.projectItem.parent && clip.projectItem.parent.name === "OpenCut_Assets") return true;
        var mediaPath = autoHeadsNormalPath(clip.projectItem.getMediaPath());
        for (var index = 0; index < AUTO_HEAD_FIXED_FOLDERS.length; index++) {
            var folder = autoHeadsNormalPath(new Folder(AUTO_HEAD_FIXED_FOLDERS[index]).fsName);
            if (mediaPath.indexOf(folder + "/") === 0) return true;
        }
    } catch (error) {}
    return false;
}

function autoHeadsClearManagedClips(videoTrack) {
    var removed = 0;
    for (var index = videoTrack.clips.numItems - 1; index >= 0; index--) {
        var clip = videoTrack.clips[index];
        if (!autoHeadsIsManagedTimelineClip(clip)) continue;
        try {
            // No ripple: removing prior generated heads must not move any edit.
            clip.remove(0, 0);
            removed++;
        } catch (error) {}
    }
    return removed;
}

function autoHeadsClearManagedClipsFromAllHeadTracks(sequence) {
    var removed = 0;
    // V1 is never scanned or modified. Prior versions used V2-V5, so clear
    // only extension-managed clips there before adding the new single-track plan.
    for (var trackIndex = 1; trackIndex < sequence.videoTracks.numTracks; trackIndex++) {
        removed += autoHeadsClearManagedClips(sequence.videoTracks[trackIndex]);
    }
    return removed;
}

function autoHeadsEnsureSupportTrack(sequence, targetIndex) {
    if (sequence.videoTracks.numTracks > targetIndex + 1) return true;
    try {
        app.enableQE();
        var qeSequence = qe.project.getActiveSequence();
        // Insert one video track directly above the selected A1 track.
        qeSequence.addTracks(1, 0, targetIndex + 1, 0);
    } catch (error) { return false; }
    return sequence.videoTracks.numTracks > targetIndex + 1;
}

function autoHeadsFindProjectItem(bin, filePath) {
    var nativePath = new File(filePath).fsName;
    for (var index = 0; index < bin.children.numItems; index++) {
        var item = bin.children[index];
        try {
            if (item.getMediaPath && autoHeadsNormalPath(item.getMediaPath()) === autoHeadsNormalPath(nativePath)) return item;
        } catch (ignored) {}
    }
    if (!app.project.importFiles([nativePath], false, bin, false)) return null;
    for (var importedIndex = 0; importedIndex < bin.children.numItems; importedIndex++) {
        var imported = bin.children[importedIndex];
        try {
            if (imported.getMediaPath && autoHeadsNormalPath(imported.getMediaPath()) === autoHeadsNormalPath(nativePath)) return imported;
        } catch (ignoredImported) {}
    }
    return null;
}

function autoHeadsFindTimelineClip(videoTrack, startSeconds) {
    if (!videoTrack || !videoTrack.clips) return null;
    var bestMatch = null;
    var bestDiff = 999999;
    for (var index = 0; index < videoTrack.clips.numItems; index++) {
        var clip = videoTrack.clips[index];
        if (!clip || !clip.start) continue;
        var diff = Math.abs(clip.start.seconds - startSeconds);
        if (diff < 0.08 && diff < bestDiff) {
            bestDiff = diff;
            bestMatch = clip;
        }
    }
    return bestMatch;
}

function autoHeadsApplyPreset(sequence, videoTrackIndex, clip, startSeconds, presetPath) {
    var file = new File(presetPath);
    if (!presetPath || !file.exists) return false;
    var nativePath = file.fsName; // QE requires a native Windows backslash path.
    try { sequence.setSelection([clip]); } catch (ignoredSelection) {}
    try {
        var qeSequence = qe.project.getActiveSequence();
        var qeTrack = typeof qeSequence.getVideoTrackAt === "function" ? qeSequence.getVideoTrackAt(videoTrackIndex) : qeSequence.getVideoTrack(videoTrackIndex);
        for (var index = 0; index < qeTrack.numItems; index++) {
            var qeClip = qeTrack.getItemAt(index);
            var qeStart = parseFloat(qeClip.start.secs);
            if (isNaN(qeStart)) qeStart = parseFloat(qeClip.start.seconds);
            if (!isNaN(qeStart) && Math.abs(qeStart - startSeconds) < 0.02) {
                if (typeof qeClip.addVideoEffect === "function" && typeof qe.project.getVideoEffectByName === "function") {
                    // Try to apply via addVideoEffect if the preset is registered as an effect
                    var effect = qe.project.getVideoEffectByName(file.name.replace(".prfpset", ""));
                    if (effect) qeClip.addVideoEffect(effect);
                }
                if (typeof qeClip.applyPreset === "function") {
                    qeClip.applyPreset(nativePath);
                    return true;
                }
            }
        }
    } catch (qeError) {}
    try {
        if (typeof clip.importAndApplyPreset === "function") {
            clip.importAndApplyPreset(nativePath);
            return true;
        }
    } catch (standardError) {}
    return false;
}

function autoHeadsAnimateMotion(clip, startSeconds, duration) {
    try {
        var endSeconds = startSeconds + duration;
        var middleSeconds = Math.min(startSeconds + 0.12, startSeconds + duration * 0.5);
        var settleSeconds = Math.min(startSeconds + 0.25, endSeconds - 0.001);
        if (settleSeconds <= middleSeconds) settleSeconds = middleSeconds + 0.001;
        for (var componentIndex = 0; componentIndex < clip.components.numItems; componentIndex++) {
            var component = clip.components[componentIndex];
            if (component.displayName !== "Motion" && component.matchName !== "AE.ADBE Motion") continue;
            for (var propertyIndex = 0; propertyIndex < component.properties.numItems; propertyIndex++) {
                var property = component.properties[propertyIndex];
                if (property.displayName !== "Scale" && property.matchName !== "ADBE Scale") continue;
                property.setTimeVarying(true);
                // A negative X scale is Premiere's native horizontal flip.
                var startTime = new Time(); startTime.seconds = startSeconds;
                var middleTime = new Time(); middleTime.seconds = middleSeconds;
                var settleTime = new Time(); settleTime.seconds = settleSeconds;
                property.setValueAtTime(startTime, [0, 0], true);
                property.setValueAtTime(middleTime, [-115, 115], true);
                property.setValueAtTime(settleTime, [-100, 100], true);
                return true;
            }
        }
    } catch (error) {}
    return false;
}

function placeHeadsFromPlan(planJson) {
    var result = { error: null, placedCount: 0, presetFailures: 0, rejectedHeads: 0, clearedCount: 0 };
    try {
        var plan = JSON.parse(planJson);
        var sequence = app.project.activeSequence;
        if (!sequence) throw new Error("Open and activate a Premiere sequence first.");
        var events = plan.events || [];
        var targetVideoTrackIndex = (parseInt(plan.videoTrack, 10) || 2) - 1;
        if (targetVideoTrackIndex < 1) throw new Error("V1 is protected. Select V2 or a higher empty track for generated heads.");
        var targetVideoTrack = sequence.videoTracks[targetVideoTrackIndex];
        if (!targetVideoTrack) throw new Error("Selected video track V" + (targetVideoTrackIndex + 1) + " does not exist.");
        if (!autoHeadsEnsureSupportTrack(sequence, targetVideoTrackIndex)) throw new Error("Could not create the supporting-head track above V" + (targetVideoTrackIndex + 1) + ".");
        var supportVideoTrackIndex = targetVideoTrackIndex + 1;
        var supportVideoTrack = sequence.videoTracks[supportVideoTrackIndex];
        for (var existingIndex = 0; existingIndex < targetVideoTrack.clips.numItems; existingIndex++) {
            if (!autoHeadsIsManagedTimelineClip(targetVideoTrack.clips[existingIndex])) {
                throw new Error("V" + (targetVideoTrackIndex + 1) + " contains a non-Auto Character Heads clip. Choose an empty heads track so it is never overwritten.");
            }
        }
        for (var supportExistingIndex = 0; supportExistingIndex < supportVideoTrack.clips.numItems; supportExistingIndex++) {
            if (!autoHeadsIsManagedTimelineClip(supportVideoTrack.clips[supportExistingIndex])) {
                throw new Error("V" + (supportVideoTrackIndex + 1) + " contains a non-Auto Character Heads clip. Choose an empty supporting-head track.");
            }
        }
        // Only the first frontend batch clears the prior generated plan.
        if (plan.clearExisting !== false) result.clearedCount = autoHeadsClearManagedClipsFromAllHeadTracks(sequence);
        var root = app.project.rootItem;
        var assetBin = null;
        for (var childIndex = 0; childIndex < root.children.numItems; childIndex++) if (root.children[childIndex].name === "OpenCut_Assets") assetBin = root.children[childIndex];
        if (!assetBin) assetBin = root.createBin("OpenCut_Assets");
        app.enableQE();
        // Reverse insertion is a second safety net for Premiere's default still duration.
        events.sort(function(a, b) { return b.start - a.start; });
        for (var index = 0; index < events.length; index++) {
            var event = events[index];
            var trackIndex = parseInt(event.trackIndex, 10);
            if (!event.headPath || !autoHeadsIsFixedFolderPath(trackIndex, event.headPath)) { result.rejectedHeads++; continue; }
            var source = autoHeadsFindProjectItem(assetBin, event.headPath);
            if (!source) { result.rejectedHeads++; continue; }
            var duration = parseFloat(event.duration);
            if (duration < 0.08) continue;
            var sourceIn = new Time(); sourceIn.seconds = 0;
            var sourceOut = new Time(); sourceOut.seconds = duration;
            try { source.setInPoint(sourceIn, 4); source.setOutPoint(sourceOut, 4); } catch (sourcePointError) {}
            var startTime = new Time(); startTime.seconds = parseFloat(event.start);
            var endTime = new Time(); endTime.seconds = parseFloat(event.end);
            var destinationTrackIndex = trackIndex === 0 ? targetVideoTrackIndex : supportVideoTrackIndex;
            var destinationTrack = trackIndex === 0 ? targetVideoTrack : supportVideoTrack;
            destinationTrack.overwriteClip(source, startTime);
            var timelineClip = autoHeadsFindTimelineClip(destinationTrack, startTime.seconds);
            if (!timelineClip) { result.rejectedHeads++; continue; }
            try { timelineClip.end = endTime; } catch (trimError) {}
            if (plan.applyPresets !== false && !autoHeadsApplyPreset(sequence, destinationTrackIndex, timelineClip, startTime.seconds, event.presetPath)) result.presetFailures++;
            if (plan.motionPop !== false) autoHeadsAnimateMotion(timelineClip, startTime.seconds, duration);
            result.placedCount++;
        }
    } catch (error) { result.error = error.toString(); }
    return JSON.stringify(result);
}

function autoHeadsEnsureAudioTrack(sequence, trackIndex) {
    try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        
        while (sequence.audioTracks.numTracks <= trackIndex) {
            var oldNum = sequence.audioTracks.numTracks;
            
            // Try standard DOM methods (available in newer Premiere versions)
            try {
                if (typeof sequence.addTracks === "function") {
                    sequence.addTracks(0, 0, 1, 0, sequence.audioTracks.numTracks); // numV, vType, numA, aType, aIdx
                }
            } catch (e1) {}
            
            // Try QE DOM methods
            try {
                if (sequence.audioTracks.numTracks === oldNum && qeSeq) {
                    if (typeof qeSeq.addTracks === "function") {
                        // In some versions: addTracks(numVideo, videoIdx, numAudio, audioType, audioIdx)
                        qeSeq.addTracks(0, 0, 1, 0, sequence.audioTracks.numTracks);
                    } else if (typeof qeSeq.addAudioTrack === "function") {
                        qeSeq.addAudioTrack();
                    }
                }
            } catch (e2) {}

            // If it didn't increase, break to avoid infinite loop
            if (sequence.audioTracks.numTracks === oldNum) {
                break;
            }
        }
    } catch (e) {}
    return sequence.audioTracks.numTracks > trackIndex;
}

function autoHeadsSetAudioClipVolume(clip, volumeDb) {
    if (!clip) return false;
    var targetDb = parseFloat(volumeDb);
    if (isNaN(targetDb)) return false;

    // Clamp between -96.0 dB and +15.0 dB (Premiere Pro native volume range)
    if (targetDb < -96.0) targetDb = -96.0;
    if (targetDb > 15.0) targetDb = 15.0;

    // Premiere Pro's ExtendScript 'Volume > Level' property expects a LINEAR multiplier:
    // 1.0 = 0.0 dB
    // 0.501 = -6.0 dB
    // 0.251 = -12.0 dB
    // 0.100 = -20.0 dB
    // Passing a negative dB number directly causes Premiere to clamp to 0.0 (which displays as -999.0 dB / mute)!
    var linearGain = Math.pow(10, targetDb / 20.0);

    var applied = false;
    try {
        if (clip.components) {
            for (var c = 0; c < clip.components.numItems; c++) {
                var comp = clip.components[c];
                var cName = (comp.displayName || comp.name || "").toLowerCase();
                var mName = (comp.matchName || "").toLowerCase();
                if (cName.indexOf("volume") !== -1 || mName.indexOf("volume") !== -1) {
                    for (var p = 0; p < comp.properties.numItems; p++) {
                        var prop = comp.properties[p];
                        var pName = (prop.displayName || prop.name || "").toLowerCase();
                        if (pName.indexOf("level") !== -1) {
                            try {
                                prop.setValue(linearGain, true);
                                applied = true;
                            } catch (e1) {
                                try {
                                    prop.setValue([linearGain], true);
                                    applied = true;
                                } catch (e2) {}
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {}

    return applied;
}

function placeSoundEffectsOnTimeline(rawOps) {
    var result = { placedCount: 0, redLabeledCount: 0, error: null };
    try {
        var ops = typeof rawOps === "string" ? JSON.parse(rawOps) : rawOps;
        var sfxList = ops.sfxOps || [];
        var sequence = app.project.activeSequence;
        if (!sequence) throw new Error("No active Premiere Pro sequence found.");

        var root = app.project.rootItem;
        var sfxBin = null;
        for (var i = 0; i < root.children.numItems; i++) {
            if (root.children[i].name === "OpenCut_SFX") {
                sfxBin = root.children[i];
                break;
            }
        }
        if (!sfxBin) sfxBin = root.createBin("OpenCut_SFX");

        app.enableQE();
        sfxList.sort(function(a, b) { return b.startTime - a.startTime; });

        for (var j = 0; j < sfxList.length; j++) {
            var item = sfxList[j];
            var filePath = item.filePath;
            var targetTrackIndex = (parseInt(item.targetTrack, 10) || 5) - 1;

            if (targetTrackIndex >= sequence.audioTracks.numTracks) {
                autoHeadsEnsureAudioTrack(sequence, targetTrackIndex);
            }
            if (targetTrackIndex >= sequence.audioTracks.numTracks) {
                targetTrackIndex = sequence.audioTracks.numTracks - 1;
            }

            var audioTrack = sequence.audioTracks[targetTrackIndex];
            if (!audioTrack) continue;

            var projItem = autoHeadsFindProjectItem(sfxBin, filePath);
            if (!projItem) continue;

            var startTime = new Time();
            startTime.seconds = parseFloat(item.startTime);

            audioTrack.overwriteClip(projItem, startTime);

            var timelineClip = autoHeadsFindTimelineClip(audioTrack, startTime.seconds);
            if (timelineClip) {
                if (item.volumeDb !== undefined && item.volumeDb !== null) {
                    autoHeadsSetAudioClipVolume(timelineClip, item.volumeDb);
                }
                if (item.isOutlier) {
                    try {
                        if (timelineClip.setColorLabel) {
                            timelineClip.setColorLabel(1);
                        } else if (timelineClip.projectItem && timelineClip.projectItem.setColorLabel) {
                            timelineClip.projectItem.setColorLabel(1);
                        }
                        result.redLabeledCount++;
                    } catch (eColor) {}
                }
                result.placedCount++;
            }
        }
    } catch (err) {
        result.error = err.toString();
    }
    return JSON.stringify(result);
}

function autoHeadsFindWaveformPreset() {
    var defaultPath = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\MediaIO\\systempresets\\3F3F3F3F_57415645\\Waveform Audio 48kHz 16-bit.epr";
    if (new File(defaultPath).exists) return defaultPath;

    var appFolder = Folder.appPackage;
    if (appFolder && appFolder.exists) {
        var presetsFolder = new Folder(appFolder.fsName + "\\MediaIO\\systempresets");
        if (presetsFolder.exists) {
            var subFolders = presetsFolder.getFiles();
            for (var i = 0; i < subFolders.length; i++) {
                if (subFolders[i] instanceof Folder) {
                    var eprFiles = subFolders[i].getFiles("*.epr");
                    for (var j = 0; j < eprFiles.length; j++) {
                        if (eprFiles[j].name.indexOf("Waveform") !== -1 || eprFiles[j].name.indexOf("WAV") !== -1) {
                            return eprFiles[j].fsName;
                        }
                    }
                }
            }
        }
    }
    return defaultPath;
}

function exportSoloTrackAudio(trackIndexStr) {
    var step = "init";
    try {
        step = "parse track index";
        var trackIndex = parseInt(trackIndexStr, 10);
        var sequence = app.project.activeSequence;
        if (!sequence) return JSON.stringify({error: "No active sequence."});
        var headsSeqName = "";
        try { headsSeqName = sequence.name || ""; } catch(eHsn) {}
        if (trackIndex < 0 || trackIndex >= sequence.audioTracks.numTracks) {
            return JSON.stringify({error: "Track index out of range."});
        }

        step = "calc sequence end";
        var trueSequenceEnd = 0.0;
        for (var v = 0; v < sequence.videoTracks.numTracks; v++) {
            var vTrack = sequence.videoTracks[v];
            for (var vc = 0; vc < vTrack.clips.numItems; vc++) {
                if (vTrack.clips[vc].end.seconds > trueSequenceEnd) {
                    trueSequenceEnd = vTrack.clips[vc].end.seconds;
                }
            }
        }
        for (var a = 0; a < sequence.audioTracks.numTracks; a++) {
            var aTrack = sequence.audioTracks[a];
            for (var ac = 0; ac < aTrack.clips.numItems; ac++) {
                if (aTrack.clips[ac].end.seconds > trueSequenceEnd) {
                    trueSequenceEnd = aTrack.clips[ac].end.seconds;
                }
            }
        }

        step = "find preset";
        var rawPresetPath = autoHeadsFindWaveformPreset();
        var presetFile = new File(rawPresetPath);
        if (!presetFile.exists) {
            return JSON.stringify({error: "Could not find Waveform export preset at: " + rawPresetPath});
        }
        var presetFsName = presetFile.fsName;

        step = "record and set mute states";
        var originalMuteStates = [];
        for (var i = 0; i < sequence.audioTracks.numTracks; i++) {
            var trk = sequence.audioTracks[i];
            var isM = 0;
            try { isM = trk.isMuted() ? 1 : 0; } catch(eM) {}
            originalMuteStates.push(isM);

            var shouldMute = (i !== trackIndex) ? 1 : 0;
            try {
                trk.setMute(shouldMute, 0);
            } catch(e1) {
                try {
                    trk.setMute(shouldMute);
                } catch(e2) {
                    try {
                        trk.setMute(shouldMute === 1);
                    } catch(e3) {}
                }
            }
        }

        step = "prepare output path";
        var runtimeFolder = getRuntimeFolder();
        var rawOutPath = runtimeFolder + "/track_A" + (trackIndex + 1) + "_timeline_render.wav";
        var outFile = new File(rawOutPath);
        if (outFile.exists) {
            try { outFile.remove(); } catch(e) {}
        }
        var outFsName = outFile.fsName;

        step = "exportAsMediaDirect";
        var exportResult = "";
        try {
            exportResult = sequence.exportAsMediaDirect(outFsName, presetFsName, 0);
        } catch(eExp1) {
            try {
                var encEntire = (app.encoder && app.encoder.ENCODE_ENTIRE !== undefined) ? app.encoder.ENCODE_ENTIRE : 0;
                exportResult = sequence.exportAsMediaDirect(outFsName, presetFsName, encEntire);
            } catch(eExp2) {
                try {
                    exportResult = sequence.exportAsMediaDirect(outFsName, presetFsName);
                } catch(eExp3) {
                    throw new Error("exportAsMediaDirect failed: " + eExp3.toString());
                }
            }
        }

        step = "restore mute states";
        for (var j = 0; j < sequence.audioTracks.numTracks; j++) {
            var rTrk = sequence.audioTracks[j];
            var origM = originalMuteStates[j];
            try {
                rTrk.setMute(origM, 0);
            } catch(re1) {
                try { rTrk.setMute(origM); } catch(re2) {
                    try { rTrk.setMute(origM === 1); } catch(re3) {}
                }
            }
        }

        step = "verify output file";
        outFile = new File(outFsName);
        if (!outFile.exists || outFile.length < 500) {
            return JSON.stringify({error: "Premiere export finished but file was not created. Result: " + exportResult});
        }

        return JSON.stringify({
            success: true,
            wavPath: outFile.fsName,
            trueSequenceEnd: trueSequenceEnd,
            sequenceName: headsSeqName,
            trackIndex: trackIndex
        });
    } catch(e) {
        return JSON.stringify({error: "Exception exporting track at step [" + step + "]: " + e.toString()});
    }
}

function autoHeadsFindProjectItemAnywhere(bin, pth) {
    if (!bin || !pth) return null;
    var targetNorm = autoHeadsNormalPath(pth);
    var targetName = targetNorm.substring(targetNorm.lastIndexOf("/") + 1);

    function search(b) {
        if (!b || !b.children) return null;
        for (var idx = 0; idx < b.children.numItems; idx++) {
            var child = b.children[idx];
            if (!child) continue;
            if (child.type === 2 || (child.children && child.children.numItems > 0)) {
                var res = search(child);
                if (res) return res;
            } else {
                if (typeof child.getMediaPath === "function") {
                    var mPath = autoHeadsNormalPath(child.getMediaPath());
                    if (mPath && mPath === targetNorm) return child;
                }
                if (child.name && autoHeadsNormalPath(child.name) === targetName) {
                    return child;
                }
            }
        }
        return null;
    }
    return search(bin);
}

function autoHeadsInsertAudioTrack(seq, atIndex) {
    var initialCount = 0;
    try { initialCount = seq.audioTracks.numTracks; } catch(e0) {}

    // 1. Try standard sequence.addTracks (numV, vIdx, numA, aType, aIdx)
    try {
        if (typeof seq.addTracks === "function") {
            seq.addTracks(0, 0, 1, 0, atIndex); // Type 0 = Mono / standard
            if (seq.audioTracks.numTracks === initialCount) {
                seq.addTracks(0, 0, 1, 1, atIndex); // Type 1 = Stereo
            }
            if (seq.audioTracks.numTracks > atIndex) return seq.audioTracks[atIndex];
        }
    } catch(e1) {}

    // 2. Try QE DOM
    try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (qeSeq) {
            if (typeof qeSeq.addTracks === "function") {
                try { qeSeq.addTracks(0, 0, 1, 0, atIndex); } catch(q1) {}
                if (seq.audioTracks.numTracks === initialCount) {
                    try { qeSeq.addTracks(0); } catch(q2) {}
                }
            }
            if (seq.audioTracks.numTracks === initialCount && typeof qeSeq.addAudioTrack === "function") {
                try { qeSeq.addAudioTrack(); } catch(q3) {}
            }
            if (seq.audioTracks.numTracks > atIndex) return seq.audioTracks[atIndex];
        }
    } catch(e2) {}

    return (atIndex < seq.audioTracks.numTracks) ? seq.audioTracks[atIndex] : seq.audioTracks[seq.audioTracks.numTracks - 1];
}

function buildCondensedAIVoiceSequence(chunksJsonStr) {
    try {
        var data = JSON.parse(chunksJsonStr);
        var chunks = data.chunks || [];
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        if (chunks.length === 0) return JSON.stringify({ success: false, error: "No spoken chunks to place." });

        var trackIndex = parseInt(data.trackIndex, 10);
        if (isNaN(trackIndex) || trackIndex < 0 || trackIndex >= seq.audioTracks.numTracks) {
            trackIndex = 0;
        }

        var targetTrack = seq.audioTracks[trackIndex];
        if (!targetTrack) return JSON.stringify({ success: false, error: "Target audio track not found." });

        var consolidatedWav = data.consolidatedWav;
        if (!consolidatedWav) return JSON.stringify({ success: false, error: "Missing consolidated master WAV path." });

        var wavFile = new File(consolidatedWav);
        if (!wavFile.exists) return JSON.stringify({ success: false, error: "Consolidated WAV file does not exist on disk: " + consolidatedWav });

        // Get or create dedicated bin: OpenCut_AIVoice
        var root = app.project.rootItem;
        var aiBin = null;
        for (var b = 0; b < root.children.numItems; b++) {
            if (root.children[b].name === "OpenCut_AIVoice") {
                aiBin = root.children[b];
                break;
            }
        }
        if (!aiBin) aiBin = root.createBin("OpenCut_AIVoice");

        // Import fresh file into bin using the proven autoHeadsFindProjectItem
        var masterItem = autoHeadsFindProjectItem(aiBin, wavFile.fsName);
        if (!masterItem) {
            app.project.importFiles([wavFile.fsName], false, aiBin, false);
            masterItem = autoHeadsFindProjectItem(aiBin, wavFile.fsName);
        }
        if (!masterItem) return JSON.stringify({ success: false, error: "Could not import WAV into Premiere bin: " + wavFile.fsName });

        // Ensure media is online
        try {
            if (typeof masterItem.isMediaOffline === "function" && masterItem.isMediaOffline()) {
                masterItem.refreshMedia();
            }
        } catch(eRef) {}

        // Place prep block 5 seconds after the absolute end of the entire video
        var trueSequenceEnd = data.trueSequenceEnd ? parseFloat(data.trueSequenceEnd) : 0.0;
        var prepStartTime = trueSequenceEnd > 0 ? (trueSequenceEnd + 5.0) : 0.0;

        // Reset master clip In/Out points to full file before placing
        var totalDur = data.totalDuration || (chunks[chunks.length - 1].outPoint);
        try {
            var zTime = new Time(); zTime.seconds = 0.0;
            var eTime = new Time(); eTime.seconds = totalDur + 1.0;
            masterItem.setInPoint(zTime, 2);
            masterItem.setOutPoint(eTime, 2);
        } catch(eIO) {}

        var insertTime = new Time();
        insertTime.seconds = prepStartTime;

        targetTrack.overwriteClip(masterItem, insertTime);

        var placedClip = autoHeadsFindTimelineClip(targetTrack, insertTime.seconds);
        if (placedClip) {
            var expEnd = new Time();
            expEnd.seconds = prepStartTime + totalDur;
            try { placedClip.end = expEnd; } catch(e) {}
        }

        var prepEndTime = prepStartTime + totalDur;

        // Auto-set In and Out markers on the sequence around the prep block
        try {
            var inMark = new Time();
            inMark.seconds = prepStartTime;
            seq.setInPoint(inMark);

            var outMark = new Time();
            outMark.seconds = prepEndTime;
            seq.setOutPoint(outMark);

            seq.setPlayerPosition(inMark);
        } catch(ioErr) {
            try {
                seq.setInPoint(prepStartTime);
                seq.setOutPoint(prepEndTime);
            } catch(ioErr2) {}
        }

        return JSON.stringify({
            success: true,
            prepStartTime: prepStartTime,
            prepEndTime: prepEndTime,
            placedCount: chunks.length,
            message: "Done! Placed " + chunks.length + " condensed speech chunks (" + totalDur.toFixed(1) + "s) at end of Track A" + (trackIndex + 1) + " (starting at " + prepStartTime.toFixed(1) + "s). In/Out markers set for export!"
        });
    } catch(e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

function resyncElevenLabsAudio(payloadStr) {
    try {
        var payload = JSON.parse(payloadStr);
        var aiAudioPath = payload.aiAudioPath;
        var syncMap = payload.syncMap || {};
        var chunks = syncMap.chunks || [];

        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        if (chunks.length === 0) return JSON.stringify({ success: false, error: "Sync map contains no chunks." });
        if (!aiAudioPath) return JSON.stringify({ success: false, error: "No AI audio file provided." });

        var origTrackIndex = parseInt(syncMap.trackIndex, 10);
        if (isNaN(origTrackIndex)) origTrackIndex = 1;
        var origTrack = seq.audioTracks[origTrackIndex];

        // 1. Clean up temporary prep clips from the end of origTrack
        if (syncMap.prepStartTime && origTrack) {
            var prepCutoff = parseFloat(syncMap.prepStartTime) - 1.0;
            for (var k = origTrack.clips.numItems - 1; k >= 0; k--) {
                var clp = origTrack.clips[k];
                if (clp.start.seconds >= prepCutoff) {
                    try { clp.remove(0, 0); } catch(remErr) {}
                }
            }
        }

        // 2. Insert new audio track directly under origTrack (shifting existing tracks down)
        var newTrackIndex = origTrackIndex + 1;
        var newTrack = autoHeadsInsertAudioTrack(seq, newTrackIndex);
        if (!newTrack) {
            newTrack = origTrack;
        }

        // 3. Import the ElevenLabs audio file into OpenCut_AIVoice bin
        var root = app.project.rootItem;
        var aiBin = null;
        for (var b = 0; b < root.children.numItems; b++) {
            if (root.children[b].name === "OpenCut_AIVoice") {
                aiBin = root.children[b];
                break;
            }
        }
        if (!aiBin) aiBin = root.createBin("OpenCut_AIVoice");

        var aiFile = new File(aiAudioPath);
        var aiItem = autoHeadsFindProjectItem(aiBin, aiFile.fsName);
        if (!aiItem) {
            app.project.importFiles([aiFile.fsName], false, aiBin, false);
            aiItem = autoHeadsFindProjectItem(aiBin, aiFile.fsName);
        }
        if (!aiItem) return JSON.stringify({ success: false, error: "Could not import AI audio file into Premiere: " + aiFile.fsName });

        // 4. Slice and place each chunk onto the new track at originalTimelineStart
        var gapDur = (syncMap && syncMap.gapDuration !== undefined) ? parseFloat(syncMap.gapDuration) : 0.5;
        var currentSourceTime = 0.0;
        var placed = 0;

        for (var c = 0; c < chunks.length; c++) {
            var chunk = chunks[c];
            var dur = chunk.duration;

            var aiIn = new Time();
            aiIn.seconds = (chunk.inPoint !== undefined) ? chunk.inPoint : currentSourceTime;

            var aiOut = new Time();
            aiOut.seconds = (chunk.outPoint !== undefined) ? chunk.outPoint : (aiIn.seconds + dur);

            // Media type 2 = audio only
            try { aiItem.setInPoint(aiIn, 2); aiItem.setOutPoint(aiOut, 2); } catch(e) {}

            var insTime = new Time();
            insTime.seconds = chunk.originalStart;

            newTrack.overwriteClip(aiItem, insTime);

            var placedClip = autoHeadsFindTimelineClip(newTrack, insTime.seconds);
            if (placedClip) {
                var expEnd = new Time();
                expEnd.seconds = chunk.originalStart + dur;
                try { placedClip.end = expEnd; } catch(e) {}
            }

            currentSourceTime = (chunk.outPoint !== undefined) ? (chunk.outPoint + gapDur) : (currentSourceTime + dur + gapDur);
            placed++;
        }

        // 5. Mute the original track with integer parameters
        if (origTrack) {
            try { origTrack.setMute(1, 0); } catch(mErr) {
                try { origTrack.setMute(1); } catch(mErr2) {}
            }
        }

        return JSON.stringify({
            success: true,
            message: "Done! Synced " + placed + " AI clips onto New Track A" + (newTrackIndex + 1) + " (perfectly aligned) and muted original Track A" + (origTrackIndex + 1) + "."
        });
    } catch(e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

function autoCutGetSequenceTracks() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence found." });

        var audioTracks = [];
        for (var i = 0; i < seq.audioTracks.numTracks; i++) {
            var trk = seq.audioTracks[i];
            var isM = false;
            try { isM = trk.isMuted(); } catch(eM) {}
            audioTracks.push({
                index: i,
                name: trk.name || ("A" + (i + 1)),
                clipCount: trk.clips.numItems,
                isMuted: isM
            });
        }

        var inPoint = 0.0;
        var outPoint = 0.0;
        try { inPoint = parseFloat(seq.getInPoint()); } catch(e) {}
        try { outPoint = parseFloat(seq.getOutPoint()); } catch(e) {}

        var cmdDiag = {};
        var testCmds = [
            "Extract", "Ripple Delete", "Close Gap", "Lift", "Clear", "Delete",
            "cmd.sequence.extract", "cmd.timeline.ripple.delete", "cmd.edit.rippledelete",
            "cmd.sequence.close.gaps", "cmd.sequence.closegap", "cmd.sequence.closegaps", "cmd.sequence.close_gap",
            "Sequence > Close Gap"
        ];
        for (var tc = 0; tc < testCmds.length; tc++) {
            try {
                cmdDiag[testCmds[tc]] = app.findMenuCommandId(testCmds[tc]);
            } catch(eCmd) {
                cmdDiag[testCmds[tc]] = -1;
            }
        }
        var hasMove = false;
        try {
            if (seq.videoTracks.numTracks > 0 && seq.videoTracks[0].clips.numItems > 0) {
                hasMove = (typeof seq.videoTracks[0].clips[0].move === "function");
            }
            if (!hasMove && seq.audioTracks.numTracks > 0 && seq.audioTracks[0].clips.numItems > 0) {
                hasMove = (typeof seq.audioTracks[0].clips[0].move === "function");
            }
        } catch(eHm) {}
        cmdDiag["hasClipMove"] = hasMove;

        try {
            var tempDir = new Folder(Folder.temp.fsName + "/OpenCut");
            if (!tempDir.exists) tempDir.create();
            var diagF = new File(tempDir.fsName + "/cmd_diag.json");
            diagF.encoding = "UTF-8";
            if (diagF.open("w")) {
                diagF.write(JSON.stringify(cmdDiag));
                diagF.close();
            }
        } catch(eDiag) {}

        var endSec = 0.0;
        for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            var at = seq.audioTracks[a];
            for (var ac = 0; ac < at.clips.numItems; ac++) {
                if (at.clips[ac].end.seconds > endSec) endSec = at.clips[ac].end.seconds;
            }
        }
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var vt = seq.videoTracks[v];
            for (var vc = 0; vc < vt.clips.numItems; vc++) {
                if (vt.clips[vc].end.seconds > endSec) endSec = vt.clips[vc].end.seconds;
            }
        }

        var videoTracks = [];
        for (var vi2 = 0; vi2 < seq.videoTracks.numTracks; vi2++) {
            var vTrk2 = seq.videoTracks[vi2];
            videoTracks.push({
                index: vi2,
                name: vTrk2.name || ("V" + (vi2 + 1)),
                clipCount: vTrk2.clips.numItems
            });
        }

        return JSON.stringify({
            success: true,
            sequenceName: seq.name,
            audioTracks: audioTracks,
            videoTracks: videoTracks,
            duration: endSec,
            inPoint: inPoint,
            outPoint: outPoint,
            hasInOut: (outPoint > inPoint),
            cmdDiag: cmdDiag
        });
    } catch(e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// Direct-from-disk silence analysis support: returns every audio clip on the selected
// tracks with timeline position, source in-point and media path. No rendering needed.
function autoCutGetTrackClipsForSilence(paramsJson) {
    try {
        var params = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
        var selected = params.trackIndices || [0];
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active Premiere Pro sequence found." });

        var inPoint = 0.0;
        var outPoint = 0.0;
        try { inPoint = parseFloat(seq.getInPoint()); } catch(e1) {}
        try { outPoint = parseFloat(seq.getOutPoint()); } catch(e2) {}
        var cachedFps = 30.0;
        try {
            var stg = seq.getSettings();
            if (stg && stg.videoFrameRate) {
                if (stg.videoFrameRate.seconds) cachedFps = 1.0 / stg.videoFrameRate.seconds;
                else if (typeof stg.videoFrameRate === "number") cachedFps = stg.videoFrameRate;
            }
        } catch(eFps) {}

        var clips = [];
        for (var ti = 0; ti < selected.length; ti++) {
            var trkIdx = parseInt(selected[ti], 10);
            if (!(trkIdx >= 0) || trkIdx >= seq.audioTracks.numTracks) continue;
            var trk = seq.audioTracks[trkIdx];
            for (var ci = 0; ci < trk.clips.numItems; ci++) {
                var clip = trk.clips[ci];
                try {
                    var start = clip.start.seconds;
                    var end = clip.end.seconds;
                    if (end - start < 0.02) continue;
                    var mediaPath = "";
                    var sourceIn = 0.0;
                    try { mediaPath = clip.projectItem.getMediaPath() || ""; } catch(eMP) {}
                    try { sourceIn = clip.inPoint.seconds; } catch(eIP) {}
                    clips.push({
                        trackIndex: trkIdx,
                        start: start,
                        end: end,
                        inPoint: sourceIn,
                        mediaPath: mediaPath,
                        clipName: clip.name || ""
                    });
                } catch(eC) {}
            }
        }

        if (clips.length === 0) {
            return JSON.stringify({ success: false, error: "No audio clips found on the selected track(s)." });
        }

        return JSON.stringify({
            success: true,
            clips: clips,
            inPoint: inPoint,
            outPoint: outPoint,
            hasInOut: (outPoint > inPoint),
            sequenceName: seq.name || "",
            fps: cachedFps
        });
    } catch(e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

function autoCutExportSelectedAudio(paramsJson) {
    var step = "init";
    try {
        var params = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
        var selectedTrackIndices = params.trackIndices || [0];
        var scope = params.scope || "entire"; // "entire" or "inout"

        var sequence = app.project.activeSequence;
        if (!sequence) return JSON.stringify({ error: "No active Premiere Pro sequence found." });

        var seqName = "";
        try { seqName = sequence.name || ""; } catch(e0) {}
        var inPoint = 0.0;
        var outPoint = 0.0;
        try { inPoint = parseFloat(sequence.getInPoint()); } catch(e1) {}
        try { outPoint = parseFloat(sequence.getOutPoint()); } catch(e2) {}
        var cachedFps = 30.0;
        try {
            var stg = sequence.getSettings();
            if (stg && stg.videoFrameRate) {
                if (stg.videoFrameRate.seconds) cachedFps = 1.0 / stg.videoFrameRate.seconds;
                else if (typeof stg.videoFrameRate === "number") cachedFps = stg.videoFrameRate;
            }
        } catch(eFps) {}

        step = "find waveform preset";
        var presetFsName = autoHeadsFindWaveformPreset();
        if (!presetFsName) {
            return JSON.stringify({ error: "Could not find Premiere's built-in 48kHz WAV export preset." });
        }

        step = "store mute states and solo selected tracks";
        var originalMuteStates = [];
        for (var i = 0; i < sequence.audioTracks.numTracks; i++) {
            var track = sequence.audioTracks[i];
            var isM = false;
            try { isM = track.isMuted(); } catch(e1) {}
            originalMuteStates.push(isM ? 1 : 0);

            var shouldMute = true;
            for (var k = 0; k < selectedTrackIndices.length; k++) {
                if (parseInt(selectedTrackIndices[k], 10) === i) {
                    shouldMute = false;
                    break;
                }
            }

            // Only toggle tracks whose state actually changes — every setMute() dirties the
            // track and forces Premiere to regenerate its audio thumbnail (visual flicker).
            if ((isM ? 1 : 0) !== (shouldMute ? 1 : 0)) {
                try {
                    track.setMute(shouldMute ? 1 : 0, 0);
                } catch(eM1) {
                    try { track.setMute(shouldMute ? 1 : 0); } catch(eM2) {}
                }
            }
        }

        step = "prepare output path";
        var runtimeFolder = Folder.temp.fsName + "\\OpenCut";
        var rfObj = new Folder(runtimeFolder);
        if (!rfObj.exists) rfObj.create();

        var runId = Date.now();
        var outFile = new File(runtimeFolder + "\\opencut_silence_analysis_" + runId + ".wav");
        if (outFile.exists) {
            try { outFile.remove(); } catch(e) {}
        }
        var outFsName = outFile.fsName;

        step = "export audio";
        var workAreaType = (scope === "inout") ? 1 : 0;
        var exportResult = null;
        var exportError = null;
        try {
            exportResult = sequence.exportAsMediaDirect(outFsName, presetFsName, workAreaType);
        } catch(eExport) {
            exportError = eExport;
        }

        step = "restore mute states";
        try {
            var restoreSeq = null;
            try { restoreSeq = app.project ? app.project.activeSequence : null; } catch(eAct) {}
            if (!restoreSeq) restoreSeq = sequence;
            if (restoreSeq && restoreSeq.audioTracks) {
                for (var j = 0; j < restoreSeq.audioTracks.numTracks; j++) {
                    try {
                        var rTrk = restoreSeq.audioTracks[j];
                        var origM = originalMuteStates[j];
                        var curM = -1;
                        try { curM = rTrk.isMuted() ? 1 : 0; } catch(eCur) {}
                        if (curM === origM) continue; // already correct: don't dirty the track
                        try { rTrk.setMute(origM, 0); } catch(re1) {
                            try { rTrk.setMute(origM); } catch(re2) {}
                        }
                    } catch(eTrk) {}
                }
            }
        } catch(eRestore) {}

        if (exportError) {
            return JSON.stringify({ error: "Audio export threw an exception (mute states were restored): " + exportError.toString() });
        }

        step = "verify output file";
        outFile = new File(outFsName);
        if (!outFile.exists || outFile.length < 500) {
            return JSON.stringify({ error: "Premiere export finished but file was not created. Result: " + exportResult });
        }

        try {
            if (app.project && sequence) {
                app.project.activeSequence = sequence;
            }
        } catch(eRefocus) {}

        return JSON.stringify({
            success: true,
            wavPath: outFile.fsName,
            scope: scope,
            inPoint: inPoint,
            outPoint: outPoint,
            sequenceName: seqName,
            fps: cachedFps
        });
    } catch(e) {
        return JSON.stringify({ error: "Exception exporting audio for analysis at step [" + step + "]: " + e.toString() });
    }
}

function autoCutGetSafeQeSequence(seq, targetName) {
    if (!seq && !targetName) return null;
    try {
        if (app.project && seq) app.project.activeSequence = seq;
    } catch(eAct) {}

    try {
        app.enableQE();
    } catch(eEq) {}

    var qeSeq = null;
    try {
        if (typeof qe !== "undefined" && qe && qe.project) {
            qeSeq = qe.project.getActiveSequence();
        }
    } catch(eQ1) {}

    if (!qeSeq) {
        try {
            var nameToFind = targetName || (seq ? seq.name : "");
            if (typeof qe !== "undefined" && qe && qe.project && qe.project.numSequences && nameToFind) {
                for (var i = 0; i < qe.project.numSequences; i++) {
                    var s = qe.project.getSequenceAt(i);
                    if (s && s.name === nameToFind) {
                        qeSeq = s;
                        break;
                    }
                }
            }
        } catch(eQ2) {}
    }

    return qeSeq;
}

// Returns true ONLY if a clip on this DOM track genuinely spans the cut point.
// Prevents the QE "razor on empty track" fatal assertion ("error: project not found.").
function autoCutTrackSpansCut(track, sec) {
    if (!track || !track.clips) return false;
    try {
        var n = track.clips.numItems;
        for (var c = 0; c < n; c++) {
            var clip = track.clips[c];
            if (!clip || !clip.start || !clip.end) continue;
            if (sec > clip.start.seconds + 0.04 && sec < clip.end.seconds - 0.04) {
                return true;
            }
        }
    } catch (e) {}
    return false;
}

// Measured snap pass: removes ALL remaining sub-frame gaps/deadspace on a track.
// Computes targets from ACTUAL clip times (self-correcting against frame quantization),
// then executes moves in strictly descending order.
function autoCutSnapTrackClips(track, snapFirstToZero) {
    var snappedCount = 0;
    if (!track || !track.clips) return 0;
    var n = 0;
    try { n = track.clips.numItems; } catch(eN) { return 0; }
    if (n === 0) return 0;

    var clips = [];
    for (var i = 0; i < n; i++) {
        try {
            var c = track.clips[i];
            if (!c || !c.start || !c.end) continue;
            clips.push(c);
        } catch(eC) {}
    }
    if (clips.length === 0) return 0;

    clips.sort(function(a, b) { return a.start.seconds - b.start.seconds; });

    // 1. Compute target start for every clip, walking forward.
    var targets = [];
    for (var k = 0; k < clips.length; k++) {
        var cStart = clips[k].start.seconds;
        var cEnd = clips[k].end.seconds;
        var t;
        if (k === 0) {
            t = cStart;
            // Leading deadspace: first clip must sit at exactly 0:00.
            if (snapFirstToZero && t > 0.0005) t = 0.0;
        } else {
            var prev = clips[k - 1];
            var prevEnd = targets[k - 1] + (prev.end.seconds - prev.start.seconds);
            if (cStart > prevEnd + 0.002) t = prevEnd; // close the measured gap
            else t = cStart; // overlapping or already flush: leave alone
        }
        targets.push(t);
    }

    // 2. Execute moves strictly from the end backwards.
    var failedCount = 0;
    for (var m = clips.length - 1; m >= 0; m--) {
        var delta = targets[m] - clips[m].start.seconds;
        if (Math.abs(delta) < 0.004) continue; // ignore sub-frame deltas
        var moved = false;
        try {
            if (typeof clips[m].move === "function") {
                try { clips[m].move(delta, 0, 1); moved = true; } catch(eM1) {
                    try { clips[m].move(delta); moved = true; } catch(eM2) {}
                }
            } else {
                failedCount++;
            }
        } catch(eM0) { moved = false; }

        if (moved) {
            // Verify the move actually landed where intended (frame quantization can block it)
            try {
                var actual = clips[m].start.seconds;
                if (Math.abs(actual - targets[m]) > 0.002) failedCount++;
                else snappedCount++;
            } catch(eV) { snappedCount++; }
        } else {
            failedCount++;
        }
    }
    return { snapped: snappedCount, failed: failedCount };
}

// Scans every track and reports clips at negative time, real overlaps, and residual gaps.
// Tolerances: overlap > 1 frame (0.04s default) or gap > 1 frame counts as an anomaly.
function autoCutVerifyTimeline(seq) {
    var report = { negativeStarts: 0, overlaps: 0, gaps: 0, details: [] };
    if (!seq) return report;
    var MAX_DETAILS = 120;

    function scanTrack(track, trackLabel) {
        if (!track || !track.clips) return;
        var clips = [];
        for (var i = 0; i < track.clips.numItems; i++) {
            try {
                var c = track.clips[i];
                if (!c || !c.start || !c.end) continue;
                clips.push({ s: c.start.seconds, e: c.end.seconds, n: (c.name || "?") });
            } catch(eC) {}
        }
        clips.sort(function(a, b) { return a.s - b.s; });

        for (var k = 0; k < clips.length; k++) {
            var c1 = clips[k];
            if (c1.s < -0.001) {
                report.negativeStarts++;
                if (report.details.length < MAX_DETAILS) {
                    report.details.push(trackLabel + ": '" + c1.n + "' starts at " + c1.s.toFixed(2) + "s (negative)");
                }
            }
            if (k > 0) {
                var prevE = clips[k - 1].e;
                if (c1.s < prevE - 0.04) {
                    report.overlaps++;
                    if (report.details.length < MAX_DETAILS) {
                        report.details.push(trackLabel + ": '" + c1.n + "' overlaps previous clip by " + (prevE - c1.s).toFixed(2) + "s at ~" + c1.s.toFixed(2) + "s");
                    }
                } else if (c1.s > prevE + 0.04) {
                    report.gaps++;
                    if (report.details.length < MAX_DETAILS) {
                        report.details.push(trackLabel + ": gap of " + (c1.s - prevE).toFixed(2) + "s before '" + c1.n + "' at ~" + c1.s.toFixed(2) + "s");
                    }
                }
            }
            if (k === 0 && c1.s > 0.04) {
                report.gaps++;
                if (report.details.length < MAX_DETAILS) {
                    report.details.push(trackLabel + ": leading deadspace of " + c1.s.toFixed(2) + "s before first clip '" + c1.n + "'");
                }
            }
        }
    }

    try {
        for (var v = 0; v < seq.videoTracks.numTracks; v++) scanTrack(seq.videoTracks[v], "V" + (v + 1));
    } catch(eV) {}
    try {
        for (var a = 0; a < seq.audioTracks.numTracks; a++) scanTrack(seq.audioTracks[a], "A" + (a + 1));
    } catch(eA) {}
    return report;
}

function autoCutExecuteSilenceCuts(planJson) {
    var cutStep = "init";
    try {
        cutStep = "parse plan";
        var plan = typeof planJson === "string" ? JSON.parse(planJson) : planJson;

        cutStep = "get sequence";
        var seq = null;
        try { seq = app.project.activeSequence; } catch(eSq) {}
        if (!seq && plan && plan.targetSequenceName) {
            try {
                for (var sq = 0; sq < app.project.sequences.numSequences; sq++) {
                    if (app.project.sequences[sq].name === plan.targetSequenceName) {
                        seq = app.project.sequences[sq];
                        app.project.activeSequence = seq;
                        break;
                    }
                }
            } catch(eSqList) {}
        }
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence found." });

        cutStep = "re-assert sequence focus";
        try { app.project.activeSequence = seq; } catch(eReassert) {}

        var silences = plan.silences || [];
        if (silences.length === 0) return JSON.stringify({ success: true, message: "no silences to cut.", cutCount: 0 });

        var management = plan.management || "remove"; // "remove", "keep", "mute", "keep_spaces"

        cutStep = "get qe sequence";
        var qeSeq = autoCutGetSafeQeSequence(seq, plan ? plan.targetSequenceName : "");
        if (!qeSeq) {
            return JSON.stringify({
                success: false,
                error: "could not connect to timeline QE sequence. please click on the timeline in Premiere Pro and try again."
            });
        }

        cutStep = "read sequence settings";
        var fps = null;
        var displayFormat = 0;
        var fpsNum = (plan && plan.fps) ? parseFloat(plan.fps) : 30.0;
        try {
            var settings = seq.getSettings();
            if (settings) {
                fps = settings.videoFrameRate;
                if (fps && fps.seconds) fpsNum = 1.0 / fps.seconds;
                else if (typeof fps === "number" && fps > 0) fpsNum = fps;
            }
        } catch(eSet) {}
        try {
            displayFormat = seq.videoDisplayFormat;
        } catch(eDisp) {}

        var numVideoTracks = 0;
        var numAudioTracks = 0;
        try { numVideoTracks = seq.videoTracks.numTracks; } catch(eNv) {}
        try { numAudioTracks = seq.audioTracks.numTracks; } catch(eNa) {}

        // LAST LINE OF DEFENSE: refuse to execute a plan that would erase the whole timeline.
        // If silences cover >= 97% of the sequence, the analysis almost certainly ran on a
        // silent/broken export — deleting everything must never be a valid outcome.
        var seqDur = 0.0;
        for (var dv = 0; dv < numVideoTracks; dv++) {
            try {
                var dt = seq.videoTracks[dv];
                for (var dc = 0; dc < dt.clips.numItems; dc++) {
                    if (dt.clips[dc].end.seconds > seqDur) seqDur = dt.clips[dc].end.seconds;
                }
            } catch(eDV) {}
        }
        for (var da = 0; da < numAudioTracks; da++) {
            try {
                var dat = seq.audioTracks[da];
                for (var dac = 0; dac < dat.clips.numItems; dac++) {
                    if (dat.clips[dac].end.seconds > seqDur) seqDur = dat.clips[dac].end.seconds;
                }
            } catch(eDA) {}
        }
        var silTotal = 0.0;
        for (var ds = 0; ds < silences.length; ds++) {
            silTotal += parseFloat(silences[ds].end) - parseFloat(silences[ds].start);
        }
        if (seqDur > 0.5 && (silTotal / seqDur) >= 0.97) {
            return JSON.stringify({
                success: false,
                error: "safety stop: this plan would remove " + Math.round((silTotal / seqDur) * 100) + "% of the entire " +
                       seqDur.toFixed(0) + "s timeline. the exported audio was likely silent or the wrong track. nothing was changed."
            });
        }

        // Sort silences strictly from end of timeline backwards to the beginning!
        silences.sort(function(a, b) {
            return parseFloat(b.start) - parseFloat(a.start);
        });

        var cutCount = 0;
        var removedCount = 0;
        var mutedCount = 0;

        function timeToTc(sec) {
            if (fps && displayFormat) {
                try {
                    var t = new Time();
                    t.seconds = sec;
                    var tc = t.getFormatted(fps, displayFormat);
                    if (tc && tc.indexOf(":") !== -1) return tc;
                } catch(e) {}
            }
            var totalSec = Math.max(0, sec);
            var hrs = Math.floor(totalSec / 3600);
            var rem = totalSec % 3600;
            var mins = Math.floor(rem / 60);
            var s = Math.floor(rem % 60);
            var frames = Math.floor((rem % 1) * fpsNum);
            function pad(n) { return (n < 10 ? "0" : "") + n; }
            return pad(hrs) + ":" + pad(mins) + ":" + pad(s) + ":" + pad(frames);
        }

        var extractCmd = 0;
        try { extractCmd = app.findMenuCommandId("Extract"); } catch(eCmd) {}
        if (!extractCmd) {
            try { extractCmd = app.findMenuCommandId("Ripple Delete"); } catch(eCmd2) {}
        }
        var closeGapCmd = 0;
        try { closeGapCmd = app.findMenuCommandId("Close Gap"); } catch(eCg0) {}

        for (var s = 0; s < silences.length; s++) {
            var sil = silences[s];
            var sStart = parseFloat(sil.start);
            var sEnd = parseFloat(sil.end);
            if (sEnd <= sStart + 0.04) continue;

            var tcStart = timeToTc(sStart);
            var tcEnd = timeToTc(sEnd);

            // 1. Explicitly razor EVERY video track at both boundaries (end first, then start)
            // CRITICAL: only razor tracks that actually span the cut point; razor on an empty
            // track triggers the QE fatal assertion "error: project not found."
            for (var vt = 0; vt < numVideoTracks; vt++) {
                try {
                    var domVTrack = seq.videoTracks[vt];
                    var qvTrack = qeSeq.getVideoTrackAt(vt);
                    if (!qvTrack || typeof qvTrack.razor !== "function") continue;
                    if (autoCutTrackSpansCut(domVTrack, sEnd)) {
                        qvTrack.razor(tcEnd);
                        cutCount++;
                    }
                    if (autoCutTrackSpansCut(domVTrack, sStart)) {
                        qvTrack.razor(tcStart);
                        cutCount++;
                    }
                } catch(eTrkV) {}
            }

            // 2. Explicitly razor EVERY audio track at both boundaries (end first, then start)
            for (var at = 0; at < numAudioTracks; at++) {
                try {
                    var domATrack = seq.audioTracks[at];
                    var qaTrack = qeSeq.getAudioTrackAt(at);
                    if (!qaTrack || typeof qaTrack.razor !== "function") continue;
                    if (autoCutTrackSpansCut(domATrack, sEnd)) {
                        qaTrack.razor(tcEnd);
                        cutCount++;
                    }
                    if (autoCutTrackSpansCut(domATrack, sStart)) {
                        qaTrack.razor(tcStart);
                        cutCount++;
                    }
                } catch(eTrkA) {}
            }

            // 3. Collect all sliced video clips inside [sStart, sEnd]
            var videoClips = [];
            for (var v = 0; v < numVideoTracks; v++) {
                try {
                    var vTrk = seq.videoTracks[v];
                    if (vTrk && vTrk.clips) {
                        for (var vc = vTrk.clips.numItems - 1; vc >= 0; vc--) {
                            var vClip = vTrk.clips[vc];
                            if (vClip && vClip.start && vClip.end) {
                                if (vClip.start.seconds >= sStart - 0.08 && vClip.end.seconds <= sEnd + 0.08) {
                                    videoClips.push(vClip);
                                }
                            }
                        }
                    }
                } catch(eTrkCollectV) {}
            }

            // 4. Collect all sliced audio clips inside [sStart, sEnd]
            var audioClips = [];
            for (var a = 0; a < numAudioTracks; a++) {
                try {
                    var aTrk = seq.audioTracks[a];
                    if (aTrk && aTrk.clips) {
                        for (var ac = aTrk.clips.numItems - 1; ac >= 0; ac--) {
                            var aClip = aTrk.clips[ac];
                            if (aClip && aClip.start && aClip.end) {
                                if (aClip.start.seconds >= sStart - 0.08 && aClip.end.seconds <= sEnd + 0.08) {
                                    audioClips.push(aClip);
                                }
                            }
                        }
                    }
                } catch(eTrkCollectA) {}
            }

            // 5. Execute chosen Silence Management
            if (management === "remove" || management === "keep_spaces") {
                // Remove all video clip slices in this silence interval
                for (var vi = videoClips.length - 1; vi >= 0; vi--) {
                    try { videoClips[vi].remove(0, 0); removedCount++; } catch(eV) {}
                }
                // Remove all audio clip slices in this silence interval
                for (var ai = audioClips.length - 1; ai >= 0; ai--) {
                    try { audioClips[ai].remove(0, 0); removedCount++; } catch(eA) {}
                }
            } else if (management === "mute") {
                // Mute the audio clips in the silence interval
                for (var ai3 = audioClips.length - 1; ai3 >= 0; ai3--) {
                    autoHeadsSetAudioClipVolume(audioClips[ai3], -96.0);
                    mutedCount++;
                }
            }
        }

        // 6. If Silence Management is "remove" (Ripple Cut), close all empty gaps on the timeline!
        var movedClipsCount = 0;
        if (management === "remove") {
            // A. Programmatically shift every remaining clip on every video and audio track
            // backward by the exact accumulated silence duration preceding that clip!
            var silencesAsc = silences.slice(0).sort(function(a, b) {
                return parseFloat(a.start) - parseFloat(b.start);
            });

            function rippleTrack(track) {
                if (!track || !track.clips) return;
                var num = track.clips.numItems;
                for (var c = 0; c < num; c++) {
                    var clip = track.clips[c];
                    if (!clip) continue;

                    var origStart = clip.start.seconds;
                    var totalPrecedingSilence = 0.0;

                    for (var sIdx = 0; sIdx < silencesAsc.length; sIdx++) {
                        var silEnd = parseFloat(silencesAsc[sIdx].end);
                        var silStart = parseFloat(silencesAsc[sIdx].start);
                        if (silEnd <= origStart + 0.05) {
                            totalPrecedingSilence += (silEnd - silStart);
                        }
                    }

                    if (totalPrecedingSilence > 0.03) {
                        var targetStart = origStart - totalPrecedingSilence;
                        if (targetStart < 0) targetStart = 0;
                        var delta = targetStart - origStart; // RELATIVE move only — never pass absolute times to clip.move()

                        if (typeof clip.move === "function" && Math.abs(delta) > 0.001) {
                            try {
                                clip.move(delta, 0, 1);
                            } catch(eM1) {
                                try { clip.move(delta); } catch(eM2) {}
                            }
                            movedClipsCount++;
                        }
                    }
                }
            }

            for (var vt = 0; vt < numVideoTracks; vt++) {
                try { rippleTrack(seq.videoTracks[vt]); } catch(eVtR) {}
            }
            for (var at = 0; at < numAudioTracks; at++) {
                try { rippleTrack(seq.audioTracks[at]); } catch(eAtR) {}
            }

            // 2nd pass: measured snap. clip.move() quantizes to frame boundaries, so
            // after many removals you can accumulate up to 1 frame of drift per silence.
            // This walk uses ACTUAL post-move clip times to slam every clip flush against
            // its predecessor, and force the first clip to 0:00 when a leading silence existed.
            var hadLeadingSilence = (silencesAsc.length > 0 && parseFloat(silencesAsc[0].start) <= 0.05);
            var snapFailures = 0;
            for (var vt2 = 0; vt2 < numVideoTracks; vt2++) {
                try {
                    var sv = autoCutSnapTrackClips(seq.videoTracks[vt2], hadLeadingSilence);
                    if (sv) { movedClipsCount += sv.snapped; snapFailures += sv.failed; }
                } catch(eSnapV) {}
            }
            for (var at2 = 0; at2 < numAudioTracks; at2++) {
                try {
                    var sa = autoCutSnapTrackClips(seq.audioTracks[at2], hadLeadingSilence);
                    if (sa) { movedClipsCount += sa.snapped; snapFailures += sa.failed; }
                } catch(eSnapA) {}
            }

            // B. Also invoke Premiere's native sequence-wide Close Gap
            try {
                app.project.activeSequence = seq;
                seq.clearInPoint();
                seq.clearOutPoint();

                var closeCmd = app.findMenuCommandId("Close Gap");
                if (!closeCmd) closeCmd = app.findMenuCommandId("cmd.sequence.close.gaps");
                if (!closeCmd) closeCmd = app.findMenuCommandId("cmd.sequence.closegap");
                if (!closeCmd) closeCmd = app.findMenuCommandId("cmd.sequence.closegaps");
                if (!closeCmd) closeCmd = app.findMenuCommandId("cmd.sequence.close_gap");

                if (closeCmd && typeof app.executeCommand === "function") {
                    app.executeCommand(closeCmd);
                }

                // Also call QE DOM close gap if available
                if (qeSeq) {
                    try { if (typeof qeSeq.closeGap === "function") qeSeq.closeGap(); } catch(q1) {}
                    try { if (typeof qeSeq.closeGaps === "function") qeSeq.closeGaps(); } catch(q2) {}
                }
            } catch(eClose) {}
        }

        try {
            seq.clearInPoint();
            seq.clearOutPoint();
        } catch(eClr) {}

        var gapNote = "";
        try { if (typeof snapFailures !== "undefined" && snapFailures > 0) {
            gapNote = " warning: " + snapFailures + " clip(s) could not be snapped flush (a gap may remain at those spots).";
        }} catch(eSN) {}

        // Post-run verification: detect clips before 0:00, real overlaps, and leftover gaps.
        var verification = autoCutVerifyTimeline(seq);
        if (verification.negativeStarts > 0 || verification.overlaps > 0 || verification.gaps > 0) {
            gapNote += " verification: " + verification.negativeStarts + " clip(s) before 0:00, " +
                       verification.overlaps + " overlap(s), " + verification.gaps + " remaining gap(s).";
            try {
                var diagDir2 = new Folder(Folder.temp.fsName + "\\OpenCut");
                if (!diagDir2.exists) diagDir2.create();
                var diagFile = new File(diagDir2.fsName + "\\opencut_verify_" + Date.now() + ".json");
                diagFile.encoding = "UTF-8";
                if (diagFile.open("w")) {
                    diagFile.write(JSON.stringify(verification, null, 2));
                    diagFile.close();
                    gapNote += " details written to " + diagFile.fsName;
                }
            } catch(eDiagWrite) {}
        }

        var actionText = management === "remove" ? "rippled and removed " + silences.length + " silence sections (shifted " + movedClipsCount + " clips to close gaps)" + gapNote :
                         (management === "mute" ? "muted " + mutedCount + " silence clips" :
                         (management === "keep_spaces" ? "deleted " + removedCount + " silence clips (kept spaces)" :
                         "made " + cutCount + " razor cuts"));

        return JSON.stringify({
            success: true,
            message: "done! successfully " + actionText + ".",
            cutCount: cutCount,
            silencesProcessed: silences.length
        });
    } catch(err) {
        return JSON.stringify({ success: false, error: "cutting error at step [" + cutStep + "]: " + err.toString() });
    }
}

// ============================================================
// AUTOPOV EXECUTION
// Razors mapped video tracks at every speaker-turn boundary, then for
// each segment keeps ONLY the speaking POV's track live; clips on the
// other POV tracks inside the segment are disabled or deleted.
// ============================================================
function povExecuteSwitch(planJson) {
    var povStep = "init";
    try {
        var plan = typeof planJson === "string" ? JSON.parse(planJson) : planJson;
        var segments = plan.segments || [];
        var povs = plan.povs || [];
        var unusedMode = plan.unusedMode || "disable"; // "disable" | "remove"

        povStep = "get sequence";
        var seq = null;
        try { seq = app.project.activeSequence; } catch(eSq) {}
        if (!seq && plan.targetSequenceName) {
            try {
                for (var sqn = 0; sqn < app.project.sequences.numSequences; sqn++) {
                    if (app.project.sequences[sqn].name === plan.targetSequenceName) {
                        seq = app.project.sequences[sqn];
                        app.project.activeSequence = seq;
                        break;
                    }
                }
            } catch(eSq2) {}
        }
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence found." });

        if (segments.length === 0) return JSON.stringify({ success: true, message: "no speaker turns detected — nothing to switch." });

        var povTracks = []; // video track indices mapped to a POV
        for (var p = 0; p < povs.length; p++) {
            var vtIdx = parseInt(povs[p].videoTrack, 10);
            if (vtIdx >= 0) povTracks.push(vtIdx);
        }
        if (povTracks.length === 0) return JSON.stringify({ success: false, error: "no POV video tracks were assigned." });

        var numVideoTracks = 0;
        try { numVideoTracks = seq.videoTracks.numTracks; } catch(eNv) {}
        for (var vtCheck = 0; vtCheck < povTracks.length; vtCheck++) {
            if (povTracks[vtCheck] >= numVideoTracks) {
                return JSON.stringify({ success: false, error: "pov references video track V" + (povTracks[vtCheck] + 1) + " which does not exist in this sequence." });
            }
        }

        // speaker audio track -> pov video track
        var speakerToPov = {};
        for (var sp = 0; sp < povs.length; sp++) {
            var spks = povs[sp].speakers || [];
            for (var sk = 0; sk < spks.length; sk++) {
                speakerToPov[parseInt(spks[sk], 10)] = parseInt(povs[sp].videoTrack, 10);
            }
        }

        povStep = "connect qe";
        var qeSeq = autoCutGetSafeQeSequence(seq, plan.targetSequenceName || "");
        if (!qeSeq) {
            return JSON.stringify({ success: false, error: "could not connect to timeline QE sequence. click the timeline in premiere and try again." });
        }

        var fps = null;
        var displayFormat = 0;
        var fpsNum = (plan && plan.fps) ? parseFloat(plan.fps) : 30.0;
        try {
            var pSettings = seq.getSettings();
            if (pSettings) {
                fps = pSettings.videoFrameRate;
                if (fps && fps.seconds) fpsNum = 1.0 / fps.seconds;
                else if (typeof fps === "number" && fps > 0) fpsNum = fps;
            }
        } catch(eSet) {}
        try { displayFormat = seq.videoDisplayFormat; } catch(eDisp) {}

        function povTimeToTc(sec) {
            if (fps && displayFormat) {
                try {
                    var t = new Time();
                    t.seconds = sec;
                    var tc = t.getFormatted(fps, displayFormat);
                    if (tc && tc.indexOf(":") !== -1) return tc;
                } catch(e) {}
            }
            var totalSec = Math.max(0, sec);
            var hrs = Math.floor(totalSec / 3600);
            var rem = totalSec % 3600;
            var mins = Math.floor(rem / 60);
            var s2 = Math.floor(rem % 60);
            var frames2 = Math.floor((rem % 1) * fpsNum);
            function pd(n) { return (n < 10 ? "0" : "") + n; }
            return pd(hrs) + ":" + pd(mins) + ":" + pd(s2) + ":" + pd(frames2);
        }

        // 1. Collect all razor boundaries, unique + descending
        var bounds = {};
        for (var bi = 0; bi < segments.length; bi++) {
            bounds[parseFloat(segments[bi].start).toFixed(2)] = true;
            bounds[parseFloat(segments[bi].end).toFixed(2)] = true;
        }
        var boundList = [];
        for (var bk in bounds) {
            if (bounds.hasOwnProperty(bk)) boundList.push(parseFloat(bk));
        }
        boundList.sort(function(a, b) { return b - a; });

        povStep = "razoring";
        var cutCount = 0;
        for (var rb = 0; rb < boundList.length; rb++) {
            var bt = boundList[rb];
            var bTc = povTimeToTc(bt);
            for (var rvt = 0; rvt < povTracks.length; rvt++) {
                var rvIdx = povTracks[rvt];
                try {
                    var domTrack = seq.videoTracks[rvIdx];
                    if (!autoCutTrackSpansCut(domTrack, bt)) continue; // QE guard: never razor empty time
                    var qTrack = qeSeq.getVideoTrackAt(rvIdx);
                    if (qTrack && typeof qTrack.razor === "function") {
                        qTrack.razor(bTc);
                        cutCount++;
                    }
                } catch(eR) {}
            }
        }

        // 2. Disable/delete clips on non-speaking POV tracks inside each segment
        povStep = "disabling unused clips";
        var disabledCount = 0;
        var removedCount = 0;
        for (var sgi = segments.length - 1; sgi >= 0; sgi--) {
            var seg = segments[sgi];
            var sStart = parseFloat(seg.start);
            var sEnd = parseFloat(seg.end);
            var speakerTrack = parseInt(seg.speakerTrack, 10);
            var keepVideoTrack = speakerToPov[speakerTrack];
            if (keepVideoTrack === undefined) continue; // speaker has no POV: leave segment alone

            for (var ovt = 0; ovt < povTracks.length; ovt++) {
                var oIdx = povTracks[ovt];
                if (oIdx === keepVideoTrack) continue;
                try {
                    var oTrk = seq.videoTracks[oIdx];
                    for (var oc = oTrk.clips.numItems - 1; oc >= 0; oc--) {
                        var oClip = oTrk.clips[oc];
                        if (!oClip || !oClip.start || !oClip.end) continue;
                        var cs = oClip.start.seconds;
                        var ce = oClip.end.seconds;
                        // Only touches slices fully inside this segment boundary set
                        if (cs >= sStart - 0.05 && ce <= sEnd + 0.05 && ce > cs) {
                            if (unusedMode === "remove") {
                                try { oClip.remove(0, 0); removedCount++; } catch(eRm) {}
                            } else {
                                try { oClip.disabled = true; disabledCount++; } catch(eDis) {}
                            }
                        }
                    }
                } catch(eOT) {}
            }

            // Ensure the active POV's clips inside this segment are ENABLED
            try {
                var kTrk = seq.videoTracks[keepVideoTrack];
                for (var kc = kTrk.clips.numItems - 1; kc >= 0; kc--) {
                    var kClip = kTrk.clips[kc];
                    if (!kClip || !kClip.start || !kClip.end) continue;
                    if (kClip.start.seconds >= sStart - 0.05 && kClip.end.seconds <= sEnd + 0.05) {
                        try { kClip.disabled = false; } catch(eEn) {}
                    }
                }
            } catch(eKT) {}
        }

        var actionText = (unusedMode === "remove")
            ? ("deleted " + removedCount + " unused pov clip(s)")
            : ("disabled " + disabledCount + " unused pov clip(s)");

        return JSON.stringify({
            success: true,
            message: "done! auto pov switched " + segments.length + " speaker turn(s) (made " + cutCount + " razor cuts, " + actionText + ").",
            turns: segments.length,
            cutCount: cutCount
        });
    } catch(err) {
        return JSON.stringify({ success: false, error: "pov error at step [" + povStep + "]: " + err.toString() });
    }
}

// ============================================================
// AUTOSEPARATE EXECUTION  (v2 — non-destructive, WAV-only)
//
// Places each speaker's speech segments onto dedicated audio tracks
// using the exported WAV file as the sole media source.
//
// CRITICAL DESIGN RULES:
//   • NEVER read, modify, razor, disable, or call setInPoint/
//     setOutPoint on the source track's clips or their projectItems.
//     Doing so mutates the master clip in the project panel and
//     corrupts every timeline instance (including linked video).
//   • Use ONLY the isolated exported WAV for placement.
//   • Create new tracks by appending at the END of the track list
//     to avoid shifting existing track indices.
//   • Mute the source track via the track header (non-destructive),
//     never by touching individual clips.
// ============================================================
function separateExecuteTracks(planJson) {
    var sepStep = "init";
    try {
        var plan = typeof planJson === "string" ? JSON.parse(planJson) : planJson;
        var segments = plan.segments || [];
        var numSpeakers = parseInt(plan.numSpeakers, 10) || 2;
        var sourceTrackIndex = parseInt(plan.sourceTrack, 10);
        if (isNaN(sourceTrackIndex)) sourceTrackIndex = 0;

        // ── 0. Resolve the active sequence ──
        sepStep = "get sequence";
        var seq = null;
        try { seq = app.project.activeSequence; } catch(eSq) {}
        if (!seq && plan.targetSequenceName) {
            try {
                for (var sqn = 0; sqn < app.project.sequences.numSequences; sqn++) {
                    if (app.project.sequences[sqn].name === plan.targetSequenceName) {
                        seq = app.project.sequences[sqn];
                        app.project.activeSequence = seq;
                        break;
                    }
                }
            } catch(eSq2) {}
        }
        if (!seq) return JSON.stringify({ success: false, error: "no active sequence found." });
        if (segments.length === 0) return JSON.stringify({ success: true, message: "no speaker segments detected — nothing to separate." });

        var numAudioTracks = 0;
        try { numAudioTracks = seq.audioTracks.numTracks; } catch(eNa) {}
        if (sourceTrackIndex >= numAudioTracks) {
            return JSON.stringify({ success: false, error: "source track A" + (sourceTrackIndex + 1) + " does not exist in this sequence." });
        }

        // ── 1. Import the exported WAV into an isolated project bin ──
        // This is the ONLY media we place onto speaker tracks.
        // We never touch the source track's projectItems.
        sepStep = "import wav";
        var wavPath = plan.wavPath;
        if (!wavPath) {
            return JSON.stringify({ success: false, error: "no exported wav file available. please click 'analyze & separate speakers' first to export the audio." });
        }
        var wFile = new File(wavPath);
        if (!wFile.exists) {
            return JSON.stringify({ success: false, error: "exported wav not found at: " + wavPath + ". please re-run the analysis." });
        }

        var root = app.project.rootItem;
        var sepBin = null;
        for (var b = 0; b < root.children.numItems; b++) {
            if (root.children[b].name === "OpenCut_Separated") {
                sepBin = root.children[b];
                break;
            }
        }
        if (!sepBin) sepBin = root.createBin("OpenCut_Separated");

        var wavItem = autoHeadsFindProjectItem(sepBin, wFile.fsName);
        if (!wavItem) {
            app.project.importFiles([wFile.fsName], false, sepBin, false);
            wavItem = autoHeadsFindProjectItem(sepBin, wFile.fsName);
        }
        if (!wavItem) {
            return JSON.stringify({ success: false, error: "could not import wav into premiere project bin." });
        }

        // ── 2. Acquire speaker tracks (reuse existing or append new) ──
        // Strategy: first scan for tracks already named "Speaker N" from
        // a previous run; if not enough, append brand-new tracks at the
        // END of the track list so we never shift existing track indices.
        sepStep = "create speaker tracks";
        var speakerTracks = [];

        // Pass 1: find existing "Speaker N" tracks
        for (var sp = 0; sp < numSpeakers; sp++) {
            var wantName = "Speaker " + (sp + 1);
            for (var ti = 0; ti < seq.audioTracks.numTracks; ti++) {
                if (ti === sourceTrackIndex) continue;
                var trkName = "";
                try { trkName = seq.audioTracks[ti].name || ""; } catch(eName) {}
                if (trkName === wantName) {
                    var reuseTrk = seq.audioTracks[ti];
                    // Clear leftover clips from a previous separation run
                    for (var rc = reuseTrk.clips.numItems - 1; rc >= 0; rc--) {
                        try { reuseTrk.clips[rc].remove(0, 0); } catch(eRm) {}
                    }
                    speakerTracks.push(reuseTrk);
                    break;
                }
            }
        }

        // Pass 2: append new tracks at the END if we still need more
        while (speakerTracks.length < numSpeakers) {
            var newIdx = seq.audioTracks.numTracks; // always append at end
            autoHeadsEnsureAudioTrack(seq, newIdx);
            if (seq.audioTracks.numTracks > newIdx) {
                var freshTrk = seq.audioTracks[newIdx];
                try { freshTrk.name = "Speaker " + (speakerTracks.length + 1); } catch(en) {}
                speakerTracks.push(freshTrk);
            } else {
                break; // could not add more tracks — stop to avoid infinite loop
            }
        }

        if (speakerTracks.length === 0) {
            return JSON.stringify({ success: false, error: "could not create any speaker tracks." });
        }

        // Ensure consistent naming
        for (var sn = 0; sn < speakerTracks.length; sn++) {
            try { speakerTracks[sn].name = "Speaker " + (sn + 1); } catch(en2) {}
        }

        // ── 3. Place each segment onto the correct speaker track ──
        // For every segment we:
        //   a) Set the WAV projectItem's in/out to the segment boundaries.
        //      This is SAFE because the WAV is an isolated media item that
        //      has no other timeline instances — it only exists in our bin.
        //   b) overwriteClip onto the (empty) speaker track.
        //   c) Trim the placed clip's .end for frame-accurate duration.
        //   d) Color-label the clip per speaker.
        sepStep = "place segments";
        var SPEAKER_COLORS = [2, 7, 4, 6, 10, 8, 1, 11]; // Caribbean, Mango, Cerulean, Rose, Teal, Purple, Iris, Magenta
        var placedCount = 0;
        var perSpeaker = {};
        for (var spI = 0; spI < numSpeakers; spI++) { perSpeaker[spI] = 0; }

        for (var si = 0; si < segments.length; si++) {
            var seg = segments[si];
            var segStart = parseFloat(seg.start);
            var segEnd = parseFloat(seg.end);
            var segSpeaker = parseInt(seg.speaker, 10);
            if (isNaN(segSpeaker) || segSpeaker < 0 || segSpeaker >= speakerTracks.length) segSpeaker = 0;
            if (segEnd - segStart < 0.04) continue; // skip sub-frame segments

            var tgt = speakerTracks[segSpeaker];
            if (!tgt) continue;

            // (a) Set WAV in/out to this segment's time range
            var mIn = new Time(); mIn.seconds = segStart;
            var mOut = new Time(); mOut.seconds = segEnd;
            try { wavItem.setInPoint(mIn, 2); wavItem.setOutPoint(mOut, 2); } catch(eIO1) {
                try { wavItem.setInPoint(mIn); wavItem.setOutPoint(mOut); } catch(eIO2) {}
            }

            // (b) Place on speaker track at matching timeline position
            var insTime = new Time(); insTime.seconds = segStart;
            tgt.overwriteClip(wavItem, insTime);

            // (c) Find the placed clip and trim its end to exact duration
            var plClip = autoHeadsFindTimelineClip(tgt, segStart);
            if (plClip) {
                var trimEnd = new Time(); trimEnd.seconds = segEnd;
                try { plClip.end = trimEnd; } catch(eTrim) {}

                // (d) Color-label at clip level only (never projectItem level,
                //     since that would color ALL instances the same)
                try {
                    if (typeof plClip.setColorLabel === "function") {
                        plClip.setColorLabel(SPEAKER_COLORS[segSpeaker % SPEAKER_COLORS.length]);
                    }
                } catch(eCol) {}

                placedCount++;
                perSpeaker[segSpeaker] = (perSpeaker[segSpeaker] || 0) + 1;
            }
        }

        // ── 4. Mute source track header (optional, fully non-destructive) ──
        // This is a track-level mute via the track header "M" button.
        // No individual clips are touched. User can unmute anytime.
        sepStep = "mute source";
        var didMute = false;
        if (plan.muteSourceTrack !== false) {
            try {
                var srcTrk = seq.audioTracks[sourceTrackIndex];
                if (srcTrk) {
                    try { srcTrk.setMute(1, 0); didMute = true; } catch(m1) {
                        try { srcTrk.setMute(1); didMute = true; } catch(m2) {}
                    }
                }
            } catch(eMute) {}
        }

        // ── 5. Report ──
        var parts = [];
        for (var ps = 0; ps < speakerTracks.length; ps++) {
            parts.push("speaker " + (ps + 1) + ": " + (perSpeaker[ps] || 0) + " clips");
        }
        var msg = "done! placed " + placedCount + " segment(s) onto " + speakerTracks.length +
            " speaker track(s) (" + parts.join(", ") + ").";
        if (didMute) msg += " source track A" + (sourceTrackIndex + 1) + " muted — click M on the track header to restore.";

        return JSON.stringify({
            success: true,
            message: msg,
            placedCount: placedCount,
            speakerTracksCount: speakerTracks.length,
            segmentsCount: segments.length
        });
    } catch(err) {
        return JSON.stringify({ success: false, error: "separation error at step [" + sepStep + "]: " + err.toString() });
    }
}

try {
    autoCutGetSequenceTracks();
} catch(eInitDiag) {}
