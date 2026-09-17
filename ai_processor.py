import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import numpy as np
import soundfile as sf
import torch



# Characters are user-defined (created in the panel). Each character is:
# {"trackIndex": int, "name": str, "images": [{"path": str, "tags": [emotion,...]}]}
# No hardcoded routes — assignments come from the user's audio track routing.


EMOTION_WORDS = {
    "happy": ("feliz", "smile", "laugh", "happy", "risada", "sorriso", "joy", "haha", "giggle", "chuckle"),
    "laughing": ("lol", "lmao", "haha", "hehe", "cackle", "dying", "rofl", "cracking up"),
    "sad": ("triste", "sad", "cry", "crying", "choro", "unhappy", "depressed", "tears", "hurt", "lonely"),
    "shocked": ("chocado", "shocked", "surprise", "surprised", "shock", "whoa", "wow", "omg", "nossa", "caramba"),
    "angry": ("raiva", "angry", "mad", "rage", "bravo", "furious", "irritated", "hate", "odio"),
    "confused": ("confuso", "confused", "doubt", "duvida", "question", "lost", "wait", "where", "how", "why", "pera"),
    "love": ("apaixonado", "love", "amor", "cute", "heart", "kiss", "fofo", "sweet", "linda", "lindo"),
    "scared": ("scared", "afraid", "fear", "terror", "creepy", "spooky", "horror", "medo", "panic", "run"),
    "disgusted": ("disgusting", "gross", "ew", "eww", "yuck", "sick", "nasty", "vile", "nojo"),
    "neutral": ("neutral", "normal", "ok", "fine", "meh", "calm"),
}


SPEECH_CUES = {
    "happy": ("haha", "hehe", "lol", "funny", "hilarious", "laugh", "smile", "joke", "yay", "awesome", "great", "nice", "cool", "happy", "excited", "legal", "demais"),
    "laughing": ("haha", "hehe", "lol", "lmao", "rofl", "dying", "cracking", "funny af", "hysterical"),
    "sad": ("sad", "miss", "lonely", "sorry", "cry", "lost", "hurt", "fail", "triste", "perdi", "droga", "desculpa", "que pena", "poxa"),
    "shocked": ("what", "whoa", "wow", "giant", "huge", "monster", "scary", "no way", "omg", "impossible", "look out", "meu deus", "que isso", "nossa", "caramba"),
    "angry": ("mad", "angry", "furious", "crush", "destroy", "payback", "hate", "fight", "smash", "rage", "stupid", "raiva", "odio", "destruir", "esmagar", "cala a boca"),
    "confused": ("wait", "which", "where", "how", "why", "lost", "confused", "dont know", "don't know", "huh", "not sure", "onde", "como", "porque", "por que", "nao entendi", "pera"),
    "love": ("love", "sweet", "heart", "kiss", "cute", "marry", "beautiful", "gorgeous", "pretty", "amor", "linda", "lindo", "fofo", "beijo"),
    "scared": ("scared", "afraid", "fear", "creepy", "spooky", "horror", "panic", "run", "behind you", "meu deus", "terror"),
    "disgusted": ("gross", "ew", "eww", "yuck", "disgusting", "nasty", "sick", "vile", "ugh", "que nojo"),
    "neutral": ("ok", "okay", "alright", "fine", "sure", "hmm", "mhm", "yeah", "yep"),
}


_whisper_model = None


def windows_path(path):
    return os.path.normpath(path).replace("/", "\\")


def write_progress(progress_path, percent, stage, detail):
    if not progress_path:
        return
    payload = {"percent": int(percent), "stage": stage, "detail": detail}
    tmp = progress_path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        os.replace(tmp, progress_path)
    except OSError:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass


def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        print("[AI] Loading WhisperModel(tiny, cpu/int8)...", flush=True)
        from faster_whisper import WhisperModel

        _whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8", cpu_threads=6)
        print("[AI] Whisper model ready.", flush=True)
    return _whisper_model


def get_audio_stream_count(media_path):
    try:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "json",
            media_path,
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res.returncode:
            return 1
        data = json.loads(res.stdout or "{}")
        return max(1, len(data.get("streams", [])))
    except Exception:
        return 1


def extract_track_audio(media_path, track_index, temp_dir):
    if not media_path or not os.path.isfile(media_path):
        return None

    stat = os.stat(media_path)
    stream_count = get_audio_stream_count(media_path)
    t_idx = int(track_index)
    if stream_count <= 1:
        actual_stream = 0
    elif t_idx == 0:
        actual_stream = 0  # Track A1 = Spidey Mic
    elif t_idx in (1, 2):
        # Track A2 (Gwen) & Track A3 (Venom) are on Discord (Stream 1)
        actual_stream = 1 if stream_count > 1 else 0
    else:
        actual_stream = max(0, min(stream_count - 1, t_idx))

    cache_key = hashlib.sha1((media_path + str(stat.st_mtime) + str(stat.st_size) + "_s" + str(actual_stream)).encode("utf-8")).hexdigest()[:16]
    wav_path = os.path.join(temp_dir, "autoheads_track_%s.wav" % cache_key)
    if os.path.isfile(wav_path) and os.path.getsize(wav_path) > 1024:
        return wav_path

    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        media_path,
        "-map",
        "0:a:%d" % actual_stream,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        wav_path,
    ]

    print("[AI] Extracting Stream %d for Track A%d: %s" % (actual_stream, t_idx + 1, os.path.basename(media_path)), flush=True)
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode:
        print("[AI] FFmpeg failed: %s" % (res.stderr[-500:]), file=sys.stderr, flush=True)
        return None
    return wav_path if os.path.isfile(wav_path) and os.path.getsize(wav_path) > 1024 else None


def extract_and_mix_audio(media_path, temp_dir):
    if not media_path or not os.path.isfile(media_path):
        return None

    stat = os.stat(media_path)
    cache_key = hashlib.sha1((media_path + str(stat.st_mtime) + str(stat.st_size)).encode("utf-8")).hexdigest()[:16]
    wav_path = os.path.join(temp_dir, "autoheads_%s.wav" % cache_key)
    if os.path.isfile(wav_path) and os.path.getsize(wav_path) > 1024:
        return wav_path

    stream_count = get_audio_stream_count(media_path)
    if stream_count <= 1:
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            media_path,
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            wav_path,
        ]
    else:
        inputs = "".join("[0:a:%d]" % index for index in range(stream_count))
        filter_graph = "%samix=inputs=%d:duration=longest:dropout_transition=0:normalize=0[mixed]" % (inputs, stream_count)
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            media_path,
            "-filter_complex",
            filter_graph,
            "-map",
            "[mixed]",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            wav_path,
        ]

    print("[AI] Extracting %d stream(s): %s" % (stream_count, os.path.basename(media_path)), flush=True)
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode:
        print("[AI] FFmpeg failed: %s" % (res.stderr[-500:]), file=sys.stderr, flush=True)
        return None
    return wav_path if os.path.isfile(wav_path) and os.path.getsize(wav_path) > 1024 else None


def profile_head_files(a, b=None):
    """Deprecated: file-name based profiling. Kept as no-op for backward compat."""
    return []


def _char_profiles(character):
    """Build head profiles from a user-defined character's tagged images."""
    images = (character or {}).get("images", []) or []
    profiles = []
    for img in images:
        p = img.get("path", "")
        if not p or not os.path.isfile(p):
            continue
        tags = [str(t).lower() for t in (img.get("tags") or [])]
        profiles.append({
            "path": windows_path(p),
            "filename": os.path.basename(p),
            "categories": [t for t in tags if t in EMOTION_WORDS],
            "default": ("neutral" in tags) or ("default" in tags),
        })
    return profiles


def text_has_cue(text, cue):
    return bool(re.search(r"(?<!\w)%s(?!\w)" % re.escape(cue), text))


import random

def choose_head(transcript, character, last_used_path=None):
    profiles = _char_profiles(character)
    if not profiles:
        return None, "No tagged head images in character"

    valid_profiles = [p for p in profiles if p["path"] != last_used_path]
    if not valid_profiles:
        valid_profiles = profiles

    text = (transcript or "").lower()
    category_scores = {}
    for category, cues in SPEECH_CUES.items():
        score = sum(1 for cue in cues if text_has_cue(text, cue))
        if score:
            category_scores[category] = score

    if "?" in text:
        category_scores["confused"] = category_scores.get("confused", 0) + 1
    if "!" in text:
        category_scores["shocked"] = category_scores.get("shocked", 0) + 1

    top_profiles = []
    best_score = -1
    for profile in valid_profiles:
        score = sum(category_scores.get(category, 0) for category in profile["categories"])
        if score > best_score:
            top_profiles = [profile]
            best_score = score
        elif score == best_score:
            top_profiles.append(profile)

    if top_profiles and best_score > 0:
        chosen = random.choice(top_profiles)
        return chosen["path"], "emotions: %s" % ", ".join(chosen["categories"]) if chosen["categories"] else "best match"

    defaults = [p for p in valid_profiles if p["default"]]
    if defaults:
        chosen = random.choice(defaults)
        return chosen["path"], "default: %s" % chosen["filename"]

    chosen = random.choice(valid_profiles)
    return chosen["path"], "fallback: %s" % chosen["filename"]


def build_character_map(characters):
    """User-driven: map ONLY the tracks the user assigned characters to."""
    character_map = {}
    for char in characters or []:
        try:
            t = int(char.get("trackIndex", -1))
        except (TypeError, ValueError):
            continue
        if t < 0:
            continue
        character_map[t] = {
            "name": char.get("name") or ("Track %d" % (t + 1)),
            "images": char.get("images", []),
        }
    return character_map


def transcribe_media(clips, enabled, temp_dir, progress_path):
    transcripts = {}
    media_wav_map = {}

    if not enabled:
        write_progress(progress_path, 65, "analysis", "AI disabled; using clip names.")
        return transcripts, media_wav_map

    valid_media = sorted(
        set(
            clip.get("mediaPath")
            for clip in clips
            if clip.get("mediaPath") and os.path.isfile(clip.get("mediaPath"))
        )
    )
    if not valid_media:
        write_progress(progress_path, 65, "analysis", "No valid media found; using clip names.")
        return transcripts, media_wav_map

    write_progress(progress_path, 35, "analysis", "Loading Whisper speech model.")
    model = get_whisper_model()
    total_media = len(valid_media)
    for media_index, media_path in enumerate(valid_media):
        wav_path = extract_and_mix_audio(media_path, temp_dir)
        if not wav_path:
            continue
        media_wav_map[media_path] = wav_path

        write_progress(
            progress_path,
            40 + int(30 * media_index / max(1, total_media)),
            "analysis",
            "Transcribing %s (%d/%d)" % (os.path.basename(media_path), media_index + 1, total_media),
        )
        print("[AI] Transcribing: %s" % os.path.basename(media_path), flush=True)
        vad_params = dict(
            threshold=0.15,
            min_silence_duration_ms=500,
            speech_pad_ms=250,
        )
        segments, _ = model.transcribe(
            wav_path,
            beam_size=1,
            vad_filter=True,
            vad_parameters=vad_params,
            word_timestamps=True,
        )

        segs = []
        for segment in segments:
            words = []
            for word in segment.words or []:
                words.append({"start": word.start, "end": word.end, "text": word.word.strip()})
            segs.append(
                {
                    "start": segment.start,
                    "end": segment.end,
                    "text": (segment.text or "").strip(),
                    "words": words,
                }
            )

        transcripts[media_path] = segs
        write_progress(
            progress_path,
            40 + int(35 * (media_index + 1) / max(1, total_media)),
            "analysis",
            "Finished %s (%d/%d)" % (os.path.basename(media_path), media_index + 1, total_media),
        )

    return transcripts, media_wav_map


def extract_speech_clips_from_transcripts(clips, transcripts, media_wav_map=None, temp_dir=None, threshold_db=-50.0, pad_sec=0.200):
    """
    Evaluates individual timeline audio clips using pure waveform energy analysis:
    - If a clip has NO waveform audio (peak < threshold_db, e.g. -50 dB): DELETED from the timeline.
    - If a clip contains speech/waveform audio:
        * Finds the exact start of audio and end of audio.
        * Adds 200ms padding before the start and 200ms padding after the end.
        * Cuts out leading dead space and trailing dead space.
    """
    trim_ops = []
    speech_clips = []
    audio_data_cache = {}
    if media_wav_map is None:
        media_wav_map = {}
    if temp_dir is None:
        temp_dir = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "OpenCut")

    def get_audio_data(path):
        if not path or not os.path.isfile(path):
            return None, 16000
        if path not in audio_data_cache:
            try:
                import soundfile as sf
                data, rate = sf.read(path, dtype="float32")
                if data.ndim > 1:
                    data = np.mean(data, axis=1)
                audio_data_cache[path] = (data, rate)
            except Exception:
                audio_data_cache[path] = (None, 16000)
        return audio_data_cache[path]

    for clip in clips:
        try:
            start = float(clip.get("start", 0))
            end = float(clip.get("end", 0))
            in_point = float(clip.get("inPoint", 0))
            track_index = int(clip.get("trackIndex", 0))
            duration = end - start
        except (TypeError, ValueError):
            continue

        if duration <= 0:
            continue

        media_path = clip.get("mediaPath")
        source_start = in_point
        source_end = in_point + duration

        # Ensure track-specific audio is available for accurate waveform analysis
        track_key = (media_path, track_index)
        wav_path = media_wav_map.get(track_key)
        if not wav_path and media_path:
            if media_path.lower().endswith(".wav") and os.path.isfile(media_path):
                wav_path = media_path
            elif os.path.isfile(media_path):
                wav_path = extract_track_audio(media_path, track_index, temp_dir)
                if wav_path:
                    media_wav_map[track_key] = wav_path

        audio_data, rate = get_audio_data(wav_path)
        clip_samples = np.array([], dtype=np.float32)
        if audio_data is not None:
            s_idx = max(0, int(source_start * rate))
            e_idx = min(len(audio_data), int(source_end * rate))
            clip_samples = audio_data[s_idx:e_idx]

        peak_amp = float(np.max(np.abs(clip_samples))) if len(clip_samples) > 0 else 0.0
        peak_db = 20 * np.log10(peak_amp + 1e-12)

        # STRICT DELETION: If this individual clip has no waveform audio (peak < threshold_db), delete it!
        if peak_db < threshold_db or len(clip_samples) == 0:
            print(
                f"[AI] Clip '{clip.get('clipName')}' at {start:.2f}s on Track A{track_index+1} has no waveform audio ({peak_db:.1f} dB < {threshold_db:.1f} dB). Deleting from timeline.",
                flush=True,
            )
            trim_ops.append({
                "trackIndex": track_index,
                "origStart": start,
                "origEnd": end,
                "remove": True,
                "reason": f"no waveform audio ({peak_db:.1f} dB < {threshold_db:.1f} dB)",
            })
            continue

        # Windowed energy analysis to find exact first and last moment of sound
        win = max(1, int(rate * 0.025))  # 25ms window
        hop = max(1, int(rate * 0.010))  # 10ms hop
        if len(clip_samples) < win:
            sc = clip.copy()
            speech_clips.append(sc)
            continue

        frames = np.lib.stride_tricks.sliding_window_view(clip_samples, win)[::hop]
        rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
        frame_db = 20 * np.log10(rms)

        active_idx = np.where(frame_db >= threshold_db)[0]
        if len(active_idx) == 0:
            print(
                f"[AI] Clip '{clip.get('clipName')}' at {start:.2f}s on Track A{track_index+1} has no energy above {threshold_db} dB. Deleting from timeline.",
                flush=True,
            )
            trim_ops.append({
                "trackIndex": track_index,
                "origStart": start,
                "origEnd": end,
                "remove": True,
                "reason": "no energy above threshold",
            })
            continue

        first_sound_sec = (active_idx[0] * hop) / rate
        last_sound_sec = (active_idx[-1] * hop + win) / rate

        # Add 200ms padding before and after
        padded_s = max(0.0, first_sound_sec - pad_sec)
        padded_e = min(duration, last_sound_sec + pad_sec)

        leading_dead_space = padded_s
        trailing_dead_space = duration - padded_e

        new_in = round(in_point + padded_s, 3)
        new_start = round(start + padded_s, 3)
        new_end = round(start + padded_e, 3)

        if new_end - new_start < 0.05:
            trim_ops.append({
                "trackIndex": track_index,
                "origStart": start,
                "origEnd": end,
                "remove": True,
                "reason": "too short after trimming",
            })
            continue

        # If leading or trailing dead space is significant (> 40ms), emit razor/in-place trim
        if leading_dead_space > 0.04 or trailing_dead_space > 0.04:
            trim_ops.append({
                "trackIndex": track_index,
                "origStart": start,
                "origEnd": end,
                "keepRanges": [
                    {
                        "start": new_start,
                        "end": new_end,
                        "inPoint": new_in,
                    }
                ],
                "newStart": new_start,
                "newEnd": new_end,
                "newInPoint": new_in,
            })

        sc = clip.copy()
        sc["start"] = new_start
        sc["end"] = new_end
        sc["inPoint"] = new_in
        speech_clips.append(sc)

    print(
        f"[AI] Waveform audio scan (threshold {threshold_db} dB, pad {pad_sec}s): "
        f"{len(clips)} timeline clip(s) -> {len(speech_clips)} active clip(s) kept, {len(trim_ops)} trim op(s).",
        flush=True,
    )
    return trim_ops, speech_clips


def window_words(words, start_t, end_t):
    ws = [w for w in words if w["end"] > start_t and w["start"] < end_t]
    if not ws:
        return [], ""
    return ws, " ".join(w["text"] for w in ws)


def generate_expression_candidates(clip, segs, decision_window, min_word_count):
    """Generate candidate expression decisions over the speech chunk."""
    source_start = float(clip.get("inPoint", 0))
    timeline_start = float(clip.get("start", 0))
    duration = float(clip.get("end", 0)) - float(clip.get("start", 0))
    source_end = source_start + duration

    candidates = []

    for seg in segs:
        speech_start = max(source_start, float(seg["start"]))
        speech_end = min(source_end, float(seg["end"]))
        if speech_end - speech_start < 0.08:
            continue

        t = speech_start
        while t < speech_end - 0.04:
            end_t = min(speech_end, t + decision_window)
            words, text = window_words(seg.get("words", []), t, end_t)
            if len(words) >= min_word_count and text.strip():
                candidates.append(
                    {
                        "source_start": t,
                        "source_end": end_t,
                        "timeline_start": timeline_start + (t - source_start),
                        "timeline_end": timeline_start + (end_t - source_start),
                        "transcript": text,
                    }
                )
            t = end_t

    return candidates


def build_events_from_candidates(candidates, character, min_hold, last_head_path=None):
    events = []
    current = None

    for c in candidates:
        head_path, reason = choose_head(c["transcript"], character, last_head_path)
        if not head_path:
            continue

        if current is None:
            last_head_path = head_path
            current = {
                "headPath": head_path,
                "start": c["timeline_start"],
                "end": c["timeline_end"],
                "duration": c["timeline_end"] - c["timeline_start"],
                "transcript": c["transcript"],
                "matchReason": reason,
            }
            continue

        if head_path == current["headPath"]:
            current["end"] = c["timeline_end"]
            current["duration"] = current["end"] - current["start"]
            continue

        # Strict min_hold prevents head flickering
        if current["duration"] >= min_hold:
            events.append(current)
            last_head_path = head_path
            current = {
                "headPath": head_path,
                "start": c["timeline_start"],
                "end": c["timeline_end"],
                "duration": c["timeline_end"] - c["timeline_start"],
                "transcript": c["transcript"],
                "matchReason": reason,
            }
        else:
            current["end"] = c["timeline_end"]
            current["duration"] = current["end"] - current["start"]

    if current is not None:
        events.append(current)
    return events


def build_speaker_turns(clips, fill_gaps=False, allowed_tracks=None):
    """Resolve overlapping audio clips into one deterministic character owner.

    The most recently started audio clip owns the current turn.
    allowed_tracks: set of audio track indices assigned to characters (user-defined).
    """
    prepared = []
    for clip_id, source_clip in enumerate(clips):
        try:
            start = float(source_clip.get("start", 0))
            end = float(source_clip.get("end", 0))
            track_index = int(source_clip.get("trackIndex", -1))
        except (TypeError, ValueError):
            continue
        if allowed_tracks is not None and track_index not in allowed_tracks or end - start < 0.08:
            continue
        clip = source_clip.copy()
        clip["_clipId"] = clip_id
        clip["start"] = start
        clip["end"] = end
        clip["trackIndex"] = track_index
        prepared.append(clip)

    boundaries = sorted(set([value for clip in prepared for value in (clip["start"], clip["end"])]))
    turns = []
    for index in range(len(boundaries) - 1):
        start = boundaries[index]
        end = boundaries[index + 1]
        if end - start < 0.001:
            continue
        active = [clip for clip in prepared if clip["start"] <= start + 0.0001 and clip["end"] >= end - 0.0001]
        if not active:
            continue
        # Newest audio cut wins. Exact ties use the lower audio-track number.
        owner = sorted(active, key=lambda clip: (clip["start"], -clip["trackIndex"]), reverse=True)[0]
        source_offset = start - owner["start"]
        turn = owner.copy()
        turn["start"] = start
        turn["end"] = end
        turn["inPoint"] = float(owner.get("inPoint", 0)) + source_offset
        if turns and turns[-1]["_clipId"] == turn["_clipId"] and abs(turns[-1]["end"] - start) < 0.001:
            turns[-1]["end"] = end
        else:
            turns.append(turn)

    if fill_gaps:
        for index in range(len(turns) - 1):
            if turns[index]["end"] < turns[index + 1]["start"]:
                turns[index]["end"] = turns[index + 1]["start"]
    return turns


def finalize_turn_events(events, turn, fill_gaps=False):
    """Anchor a turn immediately and prevent all events from leaving it."""
    if not events:
        return events
    events.sort(key=lambda event: event["start"])
    events[0]["start"] = turn["start"]
    for index in range(len(events) - 1):
        events[index]["end"] = events[index + 1]["start"]
        events[index]["duration"] = events[index]["end"] - events[index]["start"]
    events[-1]["end"] = turn["end"]
    events[-1]["duration"] = events[-1]["end"] - events[-1]["start"]
    return [event for event in events if event["duration"] >= 0.08]


def run_pipeline(input_json_path, output_json_path):
    with open(input_json_path, "r", encoding="utf-8") as f:
        request = json.load(f)

    clips = request.get("clips", [])
    character_map = build_character_map(request.get("characters", []))
    progress_path = request.get("progressPath", "")
    write_progress(progress_path, 30, "analysis", "Preparing %d dialogue cut(s)." % len(clips))

    temp_dir = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "OpenCut")
    os.makedirs(temp_dir, exist_ok=True)

    use_ai = request.get("useAI", True)
    fill_gaps = bool(request.get("fillGaps", False))
    min_hold = max(0.25, float(request.get("minimumExpressionDuration", 1.0)))
    max_hold = max(min_hold, float(request.get("maximumExpressionDuration", 4.0)))
    cadence = min(max_hold, max(0.35, min_hold / 2.0))
    min_word_count = 2

    # Step 1: Transcribe speech with sentence VAD
    transcripts, media_wav_map = transcribe_media(clips, use_ai, temp_dir, progress_path)
    write_progress(progress_path, 78, "analysis", "Analyzing speech boundaries and expressions.")

    # Step 2: Extract active speech bounds and non-destructive trimOps
    silence_threshold = float(request.get("silenceThreshold", -50.0))
    trim_ops, speech_clips = extract_speech_clips_from_transcripts(
        clips, transcripts, media_wav_map, temp_dir=temp_dir, threshold_db=silence_threshold, pad_sec=0.200
    )

    # Step 3: Resolve active speech into clean turns
    turns = build_speaker_turns(speech_clips, fill_gaps, allowed_tracks=set(character_map.keys()))
    print("[AI] Resolved %d speech clip(s) into %d character turn(s)." % (len(speech_clips), len(turns)), flush=True)

    events = []
    last_head_by_track = {}
    for clip in turns:
        try:
            track_index = int(clip.get("trackIndex", 0))
            start = float(clip.get("start", 0))
            end = float(clip.get("end", 0))
        except (TypeError, ValueError):
            continue
        if track_index not in character_map or end <= start:
            continue

        char_info = character_map[track_index]
        last_head_path = last_head_by_track.get(track_index)
        segs = transcripts.get(clip.get("mediaPath"), [])
        candidates = generate_expression_candidates(clip, segs, cadence, min_word_count) if segs else []
        head_events = build_events_from_candidates(candidates, char_info, min_hold, last_head_path) if candidates else []
        if not head_events:
            default_path, reason = choose_head(clip.get("clipName", ""), char_info, last_head_path)
            if default_path:
                head_events = [{
                    "headPath": default_path,
                    "start": start,
                    "end": end,
                    "duration": end - start,
                    "transcript": clip.get("clipName", ""),
                    "matchReason": reason,
                }]
        head_events = finalize_turn_events(head_events, clip, fill_gaps)
        for he in head_events:
            events.append(
                {
                    "trackIndex": track_index,
                    "character": char_info["name"],
                    "headPath": he["headPath"],
                    "presetPath": request.get("presetA", "") if track_index == 0 else request.get("presetB", ""),
                    "start": he["start"],
                    "end": he["end"],
                    "duration": he["duration"],
                    "transcript": he["transcript"],
                    "matchReason": he["matchReason"],
                }
            )
            last_head_by_track[track_index] = he["headPath"]

    events.sort(key=lambda event: event["start"])
    trimmed = 0
    for index in range(len(events) - 1):
        if events[index]["end"] > events[index + 1]["start"]:
            events[index]["end"] = events[index + 1]["start"]
            events[index]["duration"] = events[index]["end"] - events[index]["start"]
            trimmed += 1
    events = [event for event in events if event["duration"] >= 0.08]
    write_progress(progress_path, 92, "analysis", "Analysis complete; sending %d placement event(s)." % len(events))

    result = {
        "success": True,
        "trimOps": trim_ops,
        "events": events,
        "overlapsTrimmed": trimmed,
        "totalPlaced": len(events),
        "totalTrimmed": len(trim_ops),
    }
    with open(output_json_path, "w", encoding="utf-8") as out:
        json.dump(result, out, indent=2)
    write_progress(progress_path, 94, "analysis", "Premiere placement starting.")
    print("[AI] Complete: %d heads placed, %d clips trimmed in-place, %d overlap(s) trimmed." % (len(events), len(trim_ops), trimmed), flush=True)
def slice_sfx(request, output_path):
    file_path = request.get("filePath", "")
    in_sec = float(request.get("inSec", 0.0))
    out_sec = float(request.get("outSec", 0.0))
    if not file_path or not os.path.exists(file_path):
        raise ValueError("SFX file not found: %s" % file_path)
    if out_sec <= in_sec:
        raise ValueError("Invalid trim range: %s to %s" % (in_sec, out_sec))

    temp_backup_dir = os.path.join(tempfile.gettempdir(), "OpenCut_Backup")
    os.makedirs(temp_backup_dir, exist_ok=True)
    base_name = os.path.basename(file_path)
    timestamp_str = str(int(time.time()))
    backup_path = os.path.join(temp_backup_dir, "%s_%s" % (timestamp_str, base_name))
    shutil.copy2(file_path, backup_path)

    temp_slice_path = os.path.join(temp_backup_dir, "slice_%s_%s" % (timestamp_str, base_name))
    ffmpeg_bin = r"C:\ffmpeg\bin\ffmpeg.exe" if os.path.exists(r"C:\ffmpeg\bin\ffmpeg.exe") else "ffmpeg"
    cmd = [
        ffmpeg_bin, "-y", "-v", "error",
        "-ss", str(in_sec),
        "-to", str(out_sec),
        "-i", file_path,
        "-c:a", "pcm_s16le",
        "-ar", "44100",
        temp_slice_path
    ]
    subprocess.run(cmd, check=True)
    shutil.move(temp_slice_path, file_path)
    new_dur = out_sec - in_sec

    res = {
        "success": True,
        "mode": "slice_sfx",
        "filePath": file_path,
        "backupPath": backup_path,
        "newDuration": round(new_dur, 3)
    }
    with open(output_path, "w", encoding="utf-8") as out_f:
        json.dump(res, out_f, indent=2)
    print("[AI] Sliced SFX %s [%.2fs - %.2fs]. Backup: %s" % (base_name, in_sec, out_sec, backup_path), flush=True)
    return res


def compute_k_weighted_loudness(mono, sr=44100):
    """
    Simulates ITU-R BS.1770 K-weighting curve:
    - High-pass cuts low rumble below 80 Hz
    - High-shelf boosts ear-sensitive high-mids (1.5 kHz - 6.0 kHz) by ~+4.5 dB
    Returns the K-weighted perceived loudness in dB.
    """
    try:
        n = len(mono)
        if n < 64:
            return -60.0
        freqs = np.fft.rfftfreq(n, 1.0 / sr)
        fft = np.fft.rfft(mono)

        weights = np.ones_like(freqs)
        # High pass below 80 Hz
        low_idx = freqs < 80.0
        weights[low_idx] *= np.clip(freqs[low_idx] / 80.0, 0.05, 1.0)
        # High-shelf boost in 1500 Hz to 6000 Hz zone (+4.5 dB -> ~1.68 linear factor)
        mid_high_idx = (freqs >= 1500.0) & (freqs <= 6000.0)
        weights[mid_high_idx] *= 1.68

        weighted_time = np.fft.irfft(fft * weights, n=n)
        peak = float(np.max(np.abs(mono)))
        active = weighted_time[np.abs(mono) >= (0.1 * peak)] if peak > 1e-5 else weighted_time
        if len(active) == 0:
            active = weighted_time

        k_rms = float(np.sqrt(np.mean(active ** 2)))
        return float(20.0 * np.log10(k_rms + 1e-9))
    except Exception:
        return -60.0


def analyze_sfx_loudness(src_path, master_slider_db=-12.0):
    """
    Pure LUFS Normalization & Brickwall Limiter:
    1. Measures K-Weighted Perceived Loudness (ITU-R BS.1770)
    2. Calculates absolute gain needed to hit Target LUFS (Target = master_slider - 14)
    3. Mathematical Brickwall Peak Limiter (Peak never exceeds master_slider_db)
    """
    try:
        data, sr = sf.read(src_path)
        if len(data.shape) > 1:
            mono = np.mean(data, axis=1)
        else:
            mono = data

        peak = float(np.max(np.abs(mono)))
        if peak <= 1e-6:
            return master_slider_db - 7.0, False

        source_peak_db = float(20.0 * np.log10(peak))
        source_lufs = compute_k_weighted_loudness(mono, sr)

        # 1. Target LUFS dynamically scales with the Master Slider
        # A slider at -12 dB targets a perceived loudness of -26 LUFS
        target_lufs = master_slider_db - 14.0

        # 2. Pure Mathematical Normalization (Gain needed to hit exact target)
        gain_db = target_lufs - source_lufs

        # 3. Brickwall Peak Limiter
        # Peak can NEVER exceed the master slider
        projected_peak = source_peak_db + gain_db
        if projected_peak > master_slider_db:
            gain_db -= (projected_peak - master_slider_db)

        # 4. Strict Clamps (Sanity bounds for Premiere Pro limits)
        calculated_level_db = min(15.0, max(-60.0, gain_db))
        calculated_level_db = round(calculated_level_db, 1)

        # Check if it was an extreme transient/outlier (just for UI red labeling)
        active = mono[np.abs(mono) >= (0.1 * peak)]
        rms = float(np.sqrt(np.mean(active ** 2))) if len(active) > 0 else 1e-9
        rms_db = float(20.0 * np.log10(rms + 1e-9))
        crest_db = source_peak_db - rms_db
        is_outlier = bool(crest_db > 14.0 or source_peak_db > -1.0)

        print("[AI Leveler] %s: Peak=%.1fdB, LUFS=%.1fdB -> Premiere Volume set to %.1fdB (outlier: %s)" %
              (os.path.basename(src_path), source_peak_db, source_lufs, calculated_level_db, is_outlier), flush=True)

        return calculated_level_db, is_outlier
    except Exception as e:
        print("[AI Leveler] Warning: could not analyze %s: %s" % (src_path, e), flush=True)
        return master_slider_db - 7.0, False


def run_sfx_prediction(request_json_path, output_json_path):
    with open(request_json_path, "r", encoding="utf-8") as request_file:
        request = json.load(request_file)

    clips = request.get("clips", [])
    sfx_library = request.get("sfxLibrary", [])
    pop_rate = float(request.get("populationRate", 45)) / 100.0
    snap_to_cut = bool(request.get("snapToCut", True))
    target_track = int(request.get("targetTrack", 5))
    volume_db = float(request.get("volumeDb", -12.0))
    flag_loud_red = bool(request.get("flagLoudRed", True))
    progress_path = request.get("progressPath", "")

    temp_dir = os.path.join(tempfile.gettempdir(), "OpenCut")
    os.makedirs(temp_dir, exist_ok=True)

    write_progress(progress_path, 30, "analysis", "Transcribing sequence for punchline analysis...")
    transcripts, _ = transcribe_media(clips, True, temp_dir, progress_path)

    write_progress(progress_path, 70, "analysis", "Predicting punchline timestamps & comedic timing...")

    TAG_KEYWORDS = {
        "shocked / dramatic": ["what", "no way", "oh my god", "omg", "holy", "bro", "wait", "died", "dead", "kill", "how", "screaming", "insane"],
        "funny / awkward": ["bruh", "sucks", "fail", "stupid", "lmao", "lol", "why", "stop", "awkward", "cursed", "weird", "sus", "cute", "lipstick"],
        "exciting / hype": ["insane", "lets go", "let's go", "clutch", "yes", "win", "amazing", "huge", "fire", "epic", "god", "crazy", "subscribe"],
        "sad / defeat": ["rip", "sad", "unfortunate", "lost", "pain", "crying", "missed", "over", "gave up", "hate"],
        "impact / action": ["boom", "hit", "punch", "smack", "drop", "fell", "slap", "knocked", "shot", "bop"]
    }

    cut_times = sorted(set([float(c["start"]) for c in clips if float(c.get("start", 0)) > 0]))

    candidates = []
    for mp, segs in transcripts.items():
        for seg in segs:
            text = seg.get("text", "").lower()
            words = seg.get("words", [])
            for w in words:
                word_str = w.get("text", "")
                word_clean = re.sub(r"[^a-zA-Z0-9\']", "", word_str.lower())
                w_start = float(w["start"])

                matched_tag = None
                for tag, kw_list in TAG_KEYWORDS.items():
                    if any(kw == word_clean or (" " + kw + " ") in (" " + text + " ") for kw in kw_list):
                        matched_tag = tag
                        break

                if matched_tag:
                    best_cut = None
                    if snap_to_cut:
                        for ct in cut_times:
                            if abs(ct - w_start) <= 2.0:
                                if best_cut is None or abs(ct - w_start) < abs(best_cut - w_start):
                                    best_cut = ct

                    final_time = best_cut if best_cut is not None else w_start
                    # Score punchline priority: Punctuation is highest indicator of an actual punchline
                    score = 0.8
                    if "!" in word_str:
                        score += 1.5
                    elif "?" in word_str:
                        score += 1.0
                    if best_cut is not None:
                        score += 0.4

                    candidates.append({
                        "word": word_str,
                        "tag": matched_tag,
                        "rawTime": round(w_start, 2),
                        "snappedTime": round(final_time, 2),
                        "score": score
                    })

    # Sort candidates by punchline strength
    candidates.sort(key=lambda x: x["score"], reverse=True)

    # Candidates kept scales with population rate (doubled density per user directive):
    # At 50% pop_rate, 100% of punchline candidates are kept.
    # At 100% pop_rate, double placements are enabled with rapid 3.5s cooldown!
    effective_pop = min(1.0, pop_rate * 2.0)
    keep_target = max(1, int(len(candidates) * effective_pop)) if candidates else 0

    top_candidates = candidates[:keep_target]
    top_candidates.sort(key=lambda x: x["snappedTime"])

    # Dynamic cooldown gap:
    # At 100%: 3.5s gap (doubles timeline placements)
    # At 50%: 7.5s gap (matches what 100% was previously!)
    # At 25%: 9.5s gap
    cooldown_gap = round(3.5 + (1.0 - pop_rate) * 8.0, 1)
    last_end_time = -999.0

    valid_sfx_pool = [s for s in sfx_library if os.path.exists(s.get("path", ""))]
    recent_sfx_paths = []
    MAX_HISTORY = max(1, len(valid_sfx_pool) - 2) if len(valid_sfx_pool) > 2 else 1

    import random
    sfx_ops = []

    for cand in top_candidates:
        start_t = cand["snappedTime"]
        if start_t < last_end_time + cooldown_gap:
            continue

        tag = cand["tag"]
        # Try finding sound matching tag that hasn't been used recently
        pool = [s for s in valid_sfx_pool if s.get("tag") == tag and s.get("path") not in recent_sfx_paths]
        if not pool:
            # Fallback to any sound in library not used recently
            pool = [s for s in valid_sfx_pool if s.get("path") not in recent_sfx_paths]
        if not pool:
            # If all were used recently, just avoid the immediate last sound
            last_p = recent_sfx_paths[-1] if recent_sfx_paths else ""
            pool = [s for s in valid_sfx_pool if s.get("path") != last_p]
        if not pool:
            pool = valid_sfx_pool
        if not pool:
            continue

        chosen = random.choice(pool)
        raw_path = chosen["path"]
        dur = float(chosen.get("duration", 2.0))

        # Smart per-clip analysis: sets tailored dB with master_slider_db as absolute ceiling
        clip_level_db, is_outlier = analyze_sfx_loudness(raw_path, master_slider_db=volume_db)

        sfx_ops.append({
            "filePath": raw_path.replace("\\", "/"),
            "startTime": start_t,
            "targetTrack": target_track,
            "volumeDb": clip_level_db,
            "isOutlier": is_outlier and flag_loud_red,
            "tag": tag,
            "word": cand["word"]
        })

        last_end_time = start_t + dur
        recent_sfx_paths.append(raw_path)
        if len(recent_sfx_paths) > MAX_HISTORY:
            recent_sfx_paths.pop(0)

    write_progress(progress_path, 95, "analysis", "Placement ready: %d SFX events." % len(sfx_ops))
    result = {
        "success": True,
        "mode": "sfx",
        "sfxOps": sfx_ops,
        "totalPlaced": len(sfx_ops)
    }
    with open(output_json_path, "w", encoding="utf-8") as out:
        json.dump(result, out, indent=2)
    print("[AI] Complete: Predicted and leveled %d SFX placement(s) (no back-to-back)." % len(sfx_ops), flush=True)
    return result


def extract_high_quality_track_audio(media_path, stream_index, temp_dir):
    if not media_path or not os.path.isfile(media_path):
        return None

    stat = os.stat(media_path)
    stream_count = get_audio_stream_count(media_path)
    actual_stream = max(0, min(stream_count - 1, int(stream_index)))

    cache_key = hashlib.sha1((media_path + str(stat.st_mtime) + str(stat.st_size) + "_hq_s" + str(actual_stream)).encode("utf-8")).hexdigest()[:16]
    wav_path = os.path.join(temp_dir, "aivoice_hq_%s.wav" % cache_key)
    if os.path.isfile(wav_path) and os.path.getsize(wav_path) > 1024:
        return wav_path

    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        media_path,
        "-map",
        "0:a:%d" % actual_stream,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        wav_path,
    ]

    print("[AI] Extracting 44.1kHz audio stream %d from: %s" % (actual_stream, os.path.basename(media_path)), flush=True)
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode:
        print("[AI] FFmpeg failed: %s" % (res.stderr[-500:]), file=sys.stderr, flush=True)
        return None
    return wav_path if os.path.isfile(wav_path) and os.path.getsize(wav_path) > 1024 else None


def prep_ai_voice_from_timeline_render(timeline_wav, track_index, threshold_db, output_path):
    if not os.path.isfile(timeline_wav):
        res = {"success": False, "error": "Timeline render file not found: %s" % timeline_wav}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    print(f"[AI] Reading timeline audio render: {timeline_wav}", flush=True)
    data, rate = sf.read(timeline_wav, dtype="float32")
    if data.ndim > 1:
        data = np.mean(data, axis=1)

    total_duration = len(data) / rate
    print(f"[AI] Timeline audio duration: {total_duration:.1f}s, analyzing with threshold {threshold_db:.1f} dB...", flush=True)

    win = max(1, int(rate * 0.025))   # 25ms window
    hop = max(1, int(rate * 0.010))   # 10ms hop

    if len(data) < win:
        res = {"success": False, "error": "Timeline audio is too short."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    frames = np.lib.stride_tricks.sliding_window_view(data, win)[::hop]
    rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    frame_db = 20 * np.log10(rms)
    is_active = (frame_db >= threshold_db)

    # Bridge small pauses between syllables / words (<= 350ms)
    min_gap_frames = int(0.35 / 0.010)
    gap_start = None
    for i in range(len(is_active)):
        if not is_active[i]:
            if gap_start is None:
                gap_start = i
        else:
            if gap_start is not None:
                if (i - gap_start) <= min_gap_frames:
                    is_active[gap_start:i] = True
                gap_start = None

    # Collect contiguous active segments
    segments = []
    seg_start = None
    for i in range(len(is_active)):
        if is_active[i]:
            if seg_start is None:
                seg_start = i
        else:
            if seg_start is not None:
                segments.append((seg_start, i))
                seg_start = None
    if seg_start is not None:
        segments.append((seg_start, len(is_active)))

    # Filter out tiny noise clicks (< 150ms)
    min_speech_frames = int(0.15 / 0.010)
    valid_segments = [seg for seg in segments if (seg[1] - seg[0]) >= min_speech_frames]

    pad_sec = 0.50  # 500ms in/out padding
    extracted_chunks = []

    for seg in valid_segments:
        start_sec = (seg[0] * hop) / rate
        end_sec = (seg[1] * hop + win) / rate

        p_start_sec = max(0.0, start_sec - pad_sec)
        p_end_sec = min(total_duration, end_sec + pad_sec)
        dur = p_end_sec - p_start_sec
        if dur >= 0.2:
            sample_s = int(p_start_sec * rate)
            sample_e = int(p_end_sec * rate)
            chunk_slice = data[sample_s:sample_e]

            extracted_chunks.append({
                "samples": chunk_slice,
                "originalStart": round(p_start_sec, 3),
                "duration": round(len(chunk_slice) / rate, 3)
            })

    # Sort chunks strictly by timeline position
    extracted_chunks.sort(key=lambda x: x["originalStart"])

    # Build the single consolidated master audio file with 0.5s silence gaps
    gap_duration = 0.5
    gap_samples = np.zeros(int(rate * gap_duration), dtype=np.float32)
    master_samples_list = []
    final_chunks = []
    current_master_time = 0.0

    for i, ch in enumerate(extracted_chunks):
        c_samples = ch["samples"]
        c_dur = round(len(c_samples) / rate, 3)

        final_chunks.append({
            "chunkIndex": i,
            "inPoint": round(current_master_time, 3),
            "outPoint": round(current_master_time + c_dur, 3),
            "duration": c_dur,
            "originalStart": ch["originalStart"]
        })

        master_samples_list.append(c_samples)
        current_master_time += c_dur

        if i < len(extracted_chunks) - 1:
            master_samples_list.append(gap_samples)
            current_master_time += gap_duration

    master_audio = np.concatenate(master_samples_list) if master_samples_list else np.array([], dtype=np.float32)

    import time
    run_id = int(time.time() * 1000)
    target_dir = os.path.dirname(timeline_wav) if (timeline_wav and os.path.isdir(os.path.dirname(timeline_wav))) else tempfile.gettempdir()
    consolidated_filename = f"AIVoice_TrackA{track_index+1}_Prep_{run_id}.wav"
    consolidated_path = os.path.join(target_dir, consolidated_filename)
    sf.write(consolidated_path, master_audio, rate)

    print(f"[AI] Rendered consolidated audio ({len(master_audio)/rate:.1f}s) to: {consolidated_path}", flush=True)
    print(f"[AI] Generated {len(final_chunks)} speech chunk(s) ready for ElevenLabs prep.", flush=True)

    result = {
        "success": True,
        "consolidatedWav": consolidated_path,
        "chunks": final_chunks,
        "totalDuration": round(current_master_time, 3),
        "gapDuration": gap_duration,
        "trackIndex": track_index
    }
    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(result, out, indent=2)
    return result


def prep_ai_voice(request, output_path):
    timeline_wav = request.get("timelineWav")
    threshold_db = float(request.get("threshold", -40.0))
    track_index = int(request.get("trackIndex", 1))

    if timeline_wav and os.path.isfile(timeline_wav):
        return prep_ai_voice_from_timeline_render(timeline_wav, track_index, threshold_db, output_path)

    clips = request.get("clips", [])
    stream_index = int(request.get("streamIndex", 0))

    audio_cache = {}

    def get_clip_audio(m_path):
        if not m_path or not os.path.isfile(m_path):
            return None, 44100
        if m_path in audio_cache:
            return audio_cache[m_path]

        wav_path = None
        if m_path.lower().endswith((".wav", ".mp3", ".aac", ".m4a", ".flac", ".ogg")):
            wav_path = m_path
        else:
            temp_dir = tempfile.gettempdir()
            wav_path = extract_high_quality_track_audio(m_path, stream_index, temp_dir)
            if not wav_path or not os.path.isfile(wav_path):
                wav_path = extract_and_mix_audio(m_path, temp_dir)

        if not wav_path or not os.path.isfile(wav_path):
            audio_cache[m_path] = (None, 44100)
            return None, 44100

        try:
            data, rate = sf.read(wav_path, dtype="float32")
            if data.ndim > 1:
                data = np.mean(data, axis=1)
            audio_cache[m_path] = (data, rate)
            return data, rate
        except Exception as err:
            print(f"[AI] Error reading {wav_path}: {err}", file=sys.stderr)
            audio_cache[m_path] = (None, 44100)
            return None, 44100

    print(f"[AI] Starting AI Voice prep on {len(clips)} clip(s) with threshold {threshold_db:.1f} dB...", flush=True)

    extracted_chunks = []
    target_sample_rate = 44100

    for clip in clips:
        media_path = clip.get("mediaPath")
        if not media_path:
            continue

        in_point = float(clip.get("inPoint", 0))
        out_point = float(clip.get("outPoint", 0))
        clip_start = float(clip.get("start", 0))
        clip_dur = out_point - in_point
        if clip_dur <= 0.05:
            continue

        data, rate = get_clip_audio(media_path)
        target_sample_rate = rate
        if data is None or len(data) == 0:
            continue

        s_idx = max(0, int(in_point * rate))
        e_idx = min(len(data), int(out_point * rate))
        clip_samples = data[s_idx:e_idx]
        if len(clip_samples) == 0:
            continue

        win = max(1, int(rate * 0.025))   # 25ms window
        hop = max(1, int(rate * 0.010))   # 10ms hop
        if len(clip_samples) < win:
            peak = float(np.max(np.abs(clip_samples))) if len(clip_samples) > 0 else 0.0
            if 20 * np.log10(peak + 1e-12) >= threshold_db:
                extracted_chunks.append({
                    "samples": clip_samples,
                    "originalStart": round(clip_start, 3),
                    "duration": round(len(clip_samples) / rate, 3)
                })
            continue

        frames = np.lib.stride_tricks.sliding_window_view(clip_samples, win)[::hop]
        rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
        frame_db = 20 * np.log10(rms)
        is_active = (frame_db >= threshold_db)

        # Bridge small pauses between words/syllables (<= 350ms)
        min_gap_frames = int(0.35 / 0.010)
        gap_start = None
        for i in range(len(is_active)):
            if not is_active[i]:
                if gap_start is None:
                    gap_start = i
            else:
                if gap_start is not None:
                    if (i - gap_start) <= min_gap_frames:
                        is_active[gap_start:i] = True
                    gap_start = None

        # Collect contiguous active segments
        segments = []
        seg_start = None
        for i in range(len(is_active)):
            if is_active[i]:
                if seg_start is None:
                    seg_start = i
            else:
                if seg_start is not None:
                    segments.append((seg_start, i))
                    seg_start = None
        if seg_start is not None:
            segments.append((seg_start, len(is_active)))

        # Filter out tiny noise clicks (< 150ms)
        min_speech_frames = int(0.15 / 0.010)
        valid_segments = [seg for seg in segments if (seg[1] - seg[0]) >= min_speech_frames]

        # 500ms padding as explicitly requested!
        pad_sec = 0.50
        clip_chunks_added = 0
        for seg in valid_segments:
            start_sec = (seg[0] * hop) / rate
            end_sec = (seg[1] * hop + win) / rate

            # Padded range within this clip
            p_start_sec = max(0.0, start_sec - pad_sec)
            p_end_sec = min(clip_dur, end_sec + pad_sec)
            dur = p_end_sec - p_start_sec
            if dur >= 0.2:
                sample_s = int(p_start_sec * rate)
                sample_e = int(p_end_sec * rate)
                chunk_slice = clip_samples[sample_s:sample_e]

                orig_start = round(clip_start + p_start_sec, 3)
                extracted_chunks.append({
                    "samples": chunk_slice,
                    "originalStart": orig_start,
                    "duration": round(len(chunk_slice) / rate, 3)
                })
                clip_chunks_added += 1

        # Fallback if clip had audio but threshold was slightly strict
        if clip_chunks_added == 0:
            peak = float(np.max(np.abs(clip_samples)))
            if 20 * np.log10(peak + 1e-12) >= (threshold_db - 12.0):
                extracted_chunks.append({
                    "samples": clip_samples,
                    "originalStart": round(clip_start, 3),
                    "duration": round(len(clip_samples) / rate, 3)
                })

    # Sort chunks strictly by their original timeline position
    extracted_chunks.sort(key=lambda x: x["originalStart"])

    # Build the single consolidated master audio file
    # Gaps of 0.5s silence between chunks
    gap_duration = 0.5
    gap_samples = np.zeros(int(target_sample_rate * gap_duration), dtype=np.float32)
    master_samples_list = []
    final_chunks = []
    current_master_time = 0.0

    for i, ch in enumerate(extracted_chunks):
        c_samples = ch["samples"]
        c_dur = round(len(c_samples) / target_sample_rate, 3)

        final_chunks.append({
            "chunkIndex": i,
            "inPoint": round(current_master_time, 3),
            "outPoint": round(current_master_time + c_dur, 3),
            "duration": c_dur,
            "originalStart": ch["originalStart"]
        })

        master_samples_list.append(c_samples)
        current_master_time += c_dur

        if i < len(extracted_chunks) - 1:
            master_samples_list.append(gap_samples)
            current_master_time += gap_duration

    master_audio = np.concatenate(master_samples_list) if master_samples_list else np.array([], dtype=np.float32)

    # Save to temp directory as a pure, standalone WAV file
    consolidated_filename = f"AIVoice_TrackA{track_index+1}_Consolidated.wav"
    consolidated_path = os.path.join(tempfile.gettempdir(), consolidated_filename)
    sf.write(consolidated_path, master_audio, target_sample_rate)

    print(f"[AI] Rendered consolidated audio ({len(master_audio)/target_sample_rate:.1f}s) to: {consolidated_path}", flush=True)
    print(f"[AI] Generated {len(final_chunks)} speech chunk(s) ready for ElevenLabs prep.", flush=True)

    result = {
        "success": True,
        "consolidatedWav": consolidated_path,
        "chunks": final_chunks,
        "totalDuration": round(current_master_time, 3),
        "trackIndex": track_index
    }
    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(result, out, indent=2)
    return result


def generate_elevenlabs_sts(request, output_path):
    import requests, time
    api_key = request.get("apiKey", "").strip()
    voice_id = request.get("voiceId", "").strip()
    audio_path = request.get("audioPath", "")
    model_id = request.get("modelId", "eleven_multilingual_sts_v2")

    if not api_key:
        raise ValueError("Missing ElevenLabs API key.")
    if not voice_id:
        raise ValueError("Missing ElevenLabs Voice ID.")
    if not audio_path or not os.path.isfile(audio_path):
        raise ValueError(f"Audio file not found: {audio_path}")

    print(f"[AI] Calling ElevenLabs Speech-to-Speech API for voice {voice_id}...", flush=True)
    url = f"https://api.elevenlabs.io/v1/speech-to-speech/{voice_id}"
    headers = {"xi-api-key": api_key}

    with open(audio_path, "rb") as f:
        files = {"audio": (os.path.basename(audio_path), f, "audio/wav")}
        data = {
            "model_id": model_id,
            "voice_settings": json.dumps({
                "stability": 0.5,
                "similarity_boost": 0.8,
                "style": 0.0,
                "use_speaker_boost": True
            })
        }
        resp = requests.post(url, headers=headers, data=data, files=files, timeout=300)

    if resp.status_code != 200:
        err_msg = f"ElevenLabs API error ({resp.status_code}): {resp.text}"
        print(f"[AI] {err_msg}", file=sys.stderr, flush=True)
        res = {"success": False, "error": err_msg}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    run_id = int(time.time() * 1000)
    target_dir = os.path.dirname(audio_path)
    ai_output_filename = f"ElevenLabs_AI_Voice_{run_id}.mp3"
    ai_output_path = os.path.join(target_dir, ai_output_filename)

    with open(ai_output_path, "wb") as out_f:
        out_f.write(resp.content)

    print(f"[AI] Successfully generated AI voice ({len(resp.content)} bytes) saved to: {ai_output_path}", flush=True)
    res = {
        "success": True,
        "aiAudioPath": ai_output_path
    }
    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(res, out, indent=2)
    return res


def auto_ai_voice_pipeline(request, output_path):
    timeline_wav = request.get("timelineWav")
    threshold_db = float(request.get("threshold", -40.0))
    track_index = int(request.get("trackIndex", 1))
    api_key = request.get("apiKey", "").strip()
    voice_id = request.get("voiceId", "").strip()

    if not api_key:
        raise ValueError("Missing ElevenLabs API key.")
    if not voice_id:
        raise ValueError("Missing ElevenLabs Voice ID.")

    print(f"[AI] Step 1: Analyzing timeline audio and condensing speech...", flush=True)
    temp_prep_json = output_path.replace(".json", "_prep.json")
    prep_res = prep_ai_voice_from_timeline_render(timeline_wav, track_index, threshold_db, temp_prep_json)
    if not prep_res.get("success"):
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(prep_res, out, indent=2)
        return prep_res

    consolidated_wav = prep_res["consolidatedWav"]
    chunks = prep_res.get("chunks", [])

    if not chunks:
        res = {"success": False, "error": "No spoken dialogue detected on this track."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    print(f"[AI] Step 2: Calling ElevenLabs Speech-to-Speech API ({len(chunks)} chunks, {prep_res['totalDuration']:.1f}s)...", flush=True)
    temp_sts_json = output_path.replace(".json", "_sts.json")
    sts_req = {
        "apiKey": api_key,
        "voiceId": voice_id,
        "audioPath": consolidated_wav
    }
    sts_res = generate_elevenlabs_sts(sts_req, temp_sts_json)
    if not sts_res.get("success"):
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(sts_res, out, indent=2)
        return sts_res

    final_res = {
        "success": True,
        "aiAudioPath": sts_res["aiAudioPath"],
        "consolidatedWav": consolidated_wav,
        "chunks": chunks,
        "totalDuration": prep_res["totalDuration"],
        "gapDuration": prep_res.get("gapDuration", 0.5),
        "trackIndex": track_index
    }
    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(final_res, out, indent=2)
    return final_res


def calculate_ambient_noise_floor(request, output_path):
    wav_path = request.get("wavPath")
    if not wav_path or not os.path.isfile(wav_path):
        res = {"success": False, "error": f"Audio file not found: {wav_path}"}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    data, rate = sf.read(wav_path, dtype="float32")
    if data.ndim > 1:
        data = np.mean(data, axis=1)

    hop = int(rate * 0.02)
    win = int(rate * 0.05)
    num_frames = max(1, (len(data) - win) // hop)

    frame_energies = []
    for f in range(num_frames):
        chunk = data[f * hop : f * hop + win]
        rms = np.sqrt(np.mean(chunk**2))
        db = 20 * np.log10(rms + 1e-12)
        frame_energies.append(db)

    frame_energies = np.array(frame_energies)
    non_zero = frame_energies[frame_energies > -90.0]
    if len(non_zero) > 10:
        p15 = float(np.percentile(non_zero, 15))
        rec = min(-20.0, max(-55.0, round(p15 + 6.0, 1)))
    else:
        p15 = -60.0
        rec = -38.0

    res = {
        "success": True,
        "noiseFloorDb": round(p15, 1),
        "recommendedThreshold": rec
    }
    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(res, out, indent=2)
    return res


def _build_silence_result(is_talk, hop, rate, win, total_duration, threshold_db,
                          min_silence_ms, min_talk_ms, margin_before_ms, margin_after_ms,
                          scope_offset, output_path, clamp_min=None, clamp_max=None):
    """Shared final stage: turn a per-frame 'talk' boolean mask into the silence plan JSON."""
    num_frames = len(is_talk)

    raw_talks = []
    in_talk = False
    start_frame = 0
    for f in range(num_frames):
        if is_talk[f] and not in_talk:
            in_talk = True
            start_frame = f
        elif not is_talk[f] and in_talk:
            in_talk = False
            raw_talks.append((start_frame, f))
    if in_talk:
        raw_talks.append((start_frame, num_frames))

    min_talk_frames = int((min_talk_ms / 1000.0) * (rate / hop))
    min_sil_frames = int((min_silence_ms / 1000.0) * (rate / hop))

    filtered_talks = [t for t in raw_talks if (t[1] - t[0]) >= min_talk_frames]

    bridged_talks = []
    for t in filtered_talks:
        if not bridged_talks:
            bridged_talks.append(list(t))
        else:
            prev = bridged_talks[-1]
            gap_frames = t[0] - prev[1]
            if gap_frames < min_sil_frames:
                prev[1] = t[1]
            else:
                bridged_talks.append(list(t))

    pad_before = margin_before_ms / 1000.0
    pad_after = margin_after_ms / 1000.0

    padded_talks = []
    for t in bridged_talks:
        t_start = (t[0] * hop) / rate
        t_end = min(total_duration, (t[1] * hop + win) / rate)
        p_start = max(0.0, t_start - pad_before)
        p_end = min(total_duration, t_end + pad_after)
        padded_talks.append([p_start, p_end])

    merged_talks = []
    for pt in padded_talks:
        if not merged_talks:
            merged_talks.append(pt)
        else:
            prev = merged_talks[-1]
            if pt[0] <= prev[1]:
                prev[1] = max(prev[1], pt[1])
            else:
                merged_talks.append(pt)

    silences = []
    current_time = 0.0
    min_sil_sec = min_silence_ms / 1000.0

    for idx, t in enumerate(merged_talks):
        t_start, t_end = t[0], t[1]
        if t_start > current_time:
            sil_dur = t_start - current_time
            # For leading silence at the very start of the timeline (timestamp 0.00),
            # any deadspace >= 20ms should always be cut so the timeline starts cleanly on speech.
            is_leading = (idx == 0 and current_time == 0.0)
            thresh = 0.02 if is_leading else min_sil_sec
            if sil_dur >= thresh:
                silences.append({
                    "start": round(current_time + scope_offset, 3),
                    "end": round(t_start + scope_offset, 3),
                    "duration": round(sil_dur, 3)
                })
        current_time = t_end

    if current_time < total_duration:
        trailing_dur = total_duration - current_time
        if trailing_dur >= min_sil_sec:
            silences.append({
                "start": round(current_time + scope_offset, 3),
                "end": round(total_duration + scope_offset, 3),
                "duration": round(trailing_dur, 3)
            })

    # Clamp to scope (in/out work area) if requested: hard-confine every cut.
    if clamp_min is not None and clamp_max is not None and clamp_max > clamp_min:
        clamped = []
        for s in silences:
            s0 = max(s["start"], clamp_min)
            s1 = min(s["end"], clamp_max)
            if s1 - s0 >= float(min_silence_ms) / 1000.0:
                clamped.append({"start": round(s0, 3), "end": round(s1, 3), "duration": round(s1 - s0, 3)})
        silences = clamped

    total_silence_sec = sum(s["duration"] for s in silences)
    duration_after = max(0.0, total_duration - total_silence_sec)
    time_saved_pct = round((total_silence_sec / total_duration) * 100, 1) if total_duration > 0 else 0.0

    formatted_talks = [
        {"start": round(t[0] + scope_offset, 3), "end": round(t[1] + scope_offset, 3), "duration": round(t[1] - t[0], 3)}
        for t in merged_talks
    ]

    print(f"[AutoCut] Found {len(silences)} silence intervals ({total_silence_sec:.1f}s, {time_saved_pct}% saved) across {total_duration:.1f}s.", flush=True)

    res = {
        "success": True,
        "silences": silences,
        "talks": formatted_talks,
        "totalDuration": round(total_duration, 3),
        "totalSilence": round(total_silence_sec, 3),
        "durationAfter": round(duration_after, 3),
        "timeSaved": round(total_silence_sec, 3),
        "timeSavedPct": time_saved_pct,
        "cutCount": len(silences)
    }
    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(res, out, indent=2)
    return res


def analyze_timeline_silences(request, output_path):
    wav_path = request.get("wavPath")
    if not wav_path or not os.path.isfile(wav_path):
        res = {"success": False, "error": f"Audio file not found: {wav_path}"}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    threshold_db = float(request.get("threshold", -38.0))
    min_silence_ms = float(request.get("minSilenceMs", 150.0))
    min_talk_ms = float(request.get("minTalkMs", 100.0))
    margin_before_ms = float(request.get("marginBeforeMs", 100.0))
    margin_after_ms = float(request.get("marginAfterMs", 100.0))
    scope_offset = float(request.get("scopeOffset", 0.0))

    data, rate = sf.read(wav_path, dtype="float32")
    if data.ndim > 1:
        data = np.mean(data, axis=1)

    total_duration = len(data) / rate
    hop = int(rate * 0.01) # 10ms hop
    win = int(rate * 0.025) # 25ms win
    num_frames = max(1, (len(data) - win) // hop)

    frames_db = np.zeros(num_frames, dtype=np.float32)
    for f in range(num_frames):
        chunk = data[f * hop : f * hop + win]
        rms = np.sqrt(np.mean(chunk**2))
        frames_db[f] = 20 * np.log10(rms + 1e-12)

    is_talk = frames_db >= threshold_db

    # SAFETY: if the rendered mix contains essentially nothing above threshold,
    # the export likely captured a silent/wrongly-soloed track. Refuse to emit a
    # plan that would delete the entire timeline.
    peak_db = 20.0 * float(np.log10(np.max(np.abs(data)) + 1e-12)) if len(data) else -120.0
    talk_ratio = float(np.mean(is_talk))
    if peak_db < (threshold_db + 6.0) or talk_ratio < 0.005:
        res = {
            "success": False,
            "error": ("the exported audio looks silent: peak %.1f dB, only %.1f%% of audio above threshold %.1f dB. "
                      "refusing to cut (it would delete the whole timeline). check that the right track is selected, "
                      "is not muted in the sequence, and actually contains audio.") % (peak_db, talk_ratio * 100.0, threshold_db),
            "peakDb": round(peak_db, 1),
            "talkRatio": round(talk_ratio, 4),
        }
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    return _build_silence_result(
        is_talk, hop, rate, win, total_duration, threshold_db,
        min_silence_ms, min_talk_ms, margin_before_ms, margin_after_ms,
        scope_offset, output_path
    )


def analyze_silences_from_clips(request, output_path):
    """
    Direct-from-disk silence analysis. Reads every selected timeline clip's source media
    (no Premiere export render required), maps audio energy onto the timeline, and emits
    the same silence plan JSON as analyze_timeline_silences.
    """
    clips = request.get("clips", [])
    if not clips:
        res = {"success": False, "error": "No audio clips were supplied for analysis."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    threshold_db = float(request.get("threshold", -38.0))
    min_silence_ms = float(request.get("minSilenceMs", 150.0))
    min_talk_ms = float(request.get("minTalkMs", 100.0))
    margin_before_ms = float(request.get("marginBeforeMs", 100.0))
    margin_after_ms = float(request.get("marginAfterMs", 100.0))
    scope = request.get("scope", "entire")
    seq_in = float(request.get("seqInPoint", 0.0))
    seq_out = float(request.get("seqOutPoint", 0.0))
    clamp_min = clamp_max = None
    if scope == "inout" and seq_out > seq_in:
        clamp_min, clamp_max = seq_in, seq_out

    timeline_end = 0.0
    for c in clips:
        try:
            timeline_end = max(timeline_end, float(c.get("end", 0.0)))
        except (TypeError, ValueError):
            continue
    if timeline_end <= 0.05:
        res = {"success": False, "error": "Selected track(s) have no clip media to analyze."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    temp_dir = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "OpenCut")
    os.makedirs(temp_dir, exist_ok=True)

    HOP_SEC = 0.010
    WIN_SEC = 0.025
    num_frames = int(timeline_end / HOP_SEC) + 2
    is_talk = np.zeros(num_frames, dtype=bool)

    audio_cache = {}
    readable_clips = 0
    global_peak_db = -120.0

    def load_clip_audio(media_path, track_index):
        # Cache key MUST include the track index: multiple audio tracks on the timeline
        # can come from the same source file but reference DIFFERENT audio streams
        # (e.g. A1 = mic stream 0, A2/A3 = game/discord stream 1). A path-only cache
        # would make every track analyze the first-declared stream.
        cache_key = (media_path, int(track_index))
        if cache_key in audio_cache:
            return audio_cache[cache_key]
        data = None
        rate = 0
        try:
            if media_path.lower().endswith((".wav", ".aif", ".aiff", ".flac", ".ogg", ".mp3")) and os.path.isfile(media_path):
                data, rate = sf.read(media_path, dtype="float32")
            elif os.path.isfile(media_path):
                wav = extract_track_audio(media_path, track_index, temp_dir)
                if wav:
                    data, rate = sf.read(wav, dtype="float32")
            if data is not None and getattr(data, "ndim", 1) > 1:
                data = np.mean(data, axis=1)
        except Exception as e:
            print(f"[AutoCut] could not decode audio from {media_path}: {e}", flush=True)
            data = None
            rate = 0
        audio_cache[cache_key] = (data, rate)
        return data, rate

    for clip in clips:
        media_path = clip.get("mediaPath")
        if not media_path or not os.path.isfile(media_path):
            continue
        try:
            c_start = float(clip.get("start", 0.0))
            c_end = float(clip.get("end", 0.0))
            c_in = float(clip.get("inPoint", 0.0))
            t_idx = int(clip.get("trackIndex", 0))
        except (TypeError, ValueError):
            continue
        c_dur = c_end - c_start
        if c_dur < 0.02:
            continue

        data, rate = load_clip_audio(media_path, t_idx)
        if data is None or len(data) == 0:
            continue
        readable_clips += 1

        s_idx = max(0, int(c_in * rate))
        e_idx = min(len(data), int((c_in + c_dur) * rate))
        seg = data[s_idx:e_idx]
        if len(seg) == 0:
            continue

        peak = float(np.max(np.abs(seg)))
        peak_db = 20.0 * float(np.log10(peak + 1e-12))
        global_peak_db = max(global_peak_db, peak_db)

        hop_l = max(1, int(rate * HOP_SEC))
        win_l = max(1, int(rate * WIN_SEC))

        if len(seg) < win_l:
            if peak_db >= threshold_db:
                g0 = int(c_start / HOP_SEC)
                g1 = min(num_frames, int(c_end / HOP_SEC) + 1)
                is_talk[g0:g1] = True
            continue

        frames = np.lib.stride_tricks.sliding_window_view(seg, win_l)[::hop_l]
        rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
        frame_db = 20 * np.log10(rms)
        active = frame_db >= threshold_db

        if not np.any(active):
            continue

        frame_secs = hop_l / rate
        indices = np.where(active)[0]
        # Mark EVERY active frame individually (never the bounding span — that would hide
        # internal silences). Each active frame covers [t, t + frame_secs] on the timeline.
        g_first = np.clip(np.round((c_start + indices * frame_secs) / HOP_SEC).astype(int), 0, num_frames - 1)
        g_last = np.clip(np.round((c_start + (indices + 1) * frame_secs) / HOP_SEC).astype(int) + 1, 0, num_frames)
        if len(indices) < 200:
            for a, b in zip(g_first, g_last):
                is_talk[a:b] = True
        else:
            # faster vectorized equivalent for big clips
            diff = np.zeros(num_frames + 1, dtype=np.int32)
            np.add.at(diff, g_first, 1)
            np.add.at(diff, g_last, -1)
            is_talk |= (np.cumsum(diff)[:num_frames] > 0)

    if readable_clips == 0:
        res = {
            "success": False,
            "error": "could not read audio from any selected clip's source media "
                     "(nested/compounded sequences or offline media are not readable directly). "
                     "fall back to rendering the timeline audio instead."
        }
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    # SAFETY: same guard as the export path — if literally nothing is above the threshold,
    # refuse to emit a plan that would delete the whole timeline.
    talk_ratio = float(np.mean(is_talk))
    if global_peak_db < (threshold_db + 6.0) or talk_ratio < 0.005:
        res = {
            "success": False,
            "error": ("the selected track audio measures as silent: peak %.1f dB, only %.1f%% of timeline above %.1f dB. "
                      "refusing to cut (it would delete the whole timeline). check track selection / mutes.") % (
                          global_peak_db, talk_ratio * 100.0, threshold_db),
            "peakDb": round(global_peak_db, 1),
            "talkRatio": round(talk_ratio, 4),
        }
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    print(f"[AutoCut] Clip-direct analysis: {readable_clips}/{len(clips)} clip(s) of selected track(s) decoded "
          f"({timeline_end:.1f}s timeline, peak {global_peak_db:.1f} dB).", flush=True)

    # In/out scope: force 'talk' outside the work area so nothing outside it is ever cut.
    if clamp_min is not None and clamp_max is not None:
        cut_lo = 0 if clamp_min <= 0 else int(np.ceil(clamp_min / HOP_SEC))
        cut_hi = int(np.floor(clamp_max / HOP_SEC))
        is_talk[:max(0, cut_lo)] = True
        is_talk[max(0, cut_hi):] = True

    # Feed the shared stage with rate in seconds-units where granularity == HOP_SEC.
    # We emulate rate/hop relation: rate = 1000 "samples/sec", hop = 10 -> frame duration 10ms.
    return _build_silence_result(
        is_talk, 10, 1000, 25, timeline_end, threshold_db,
        min_silence_ms, min_talk_ms, margin_before_ms, margin_after_ms,
        0.0, output_path, clamp_min=clamp_min, clamp_max=clamp_max
    )


def analyze_pov_turns(request, output_path):
    """
    Per-speaker talk detection for AutoPOV. Reads each selected audio track's clips
    directly from disk, builds a per-track 'talking' mask, then resolves overlaps by
    speaker priority (higher priority wins, ties go to the most recent speaker).
    Emits contiguous speaker-turn segments for the POV switcher.
    """
    clips = request.get("clips", [])
    speakers = request.get("speakers", [])  # [{trackIndex, name, priority}]
    if not clips or not speakers:
        res = {"success": False, "error": "need at least one speaker and one audio clip."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    threshold_db = float(request.get("threshold", -38.0))
    min_shot_ms = float(request.get("minShotMs", 500.0))
    bridge_ms = float(request.get("bridgeGapMs", 350.0))
    scope = request.get("scope", "entire")
    seq_in = float(request.get("seqInPoint", 0.0))
    seq_out = float(request.get("seqOutPoint", 0.0))
    clamp_min = clamp_max = None
    if scope == "inout" and seq_out > seq_in:
        clamp_min, clamp_max = seq_in, seq_out

    HOP_SEC = 0.010
    WIN_SEC = 0.025

    timeline_end = 0.0
    for c in clips:
        try:
            timeline_end = max(timeline_end, float(c.get("end", 0.0)))
        except (TypeError, ValueError):
            continue
    if timeline_end <= 0.05:
        res = {"success": False, "error": "no audio clips found on the selected speaker tracks."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    num_frames = int(timeline_end / HOP_SEC) + 2
    temp_dir = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "OpenCut")
    os.makedirs(temp_dir, exist_ok=True)

    # speaker track index -> {mask, priority, name}
    track_masks = {}
    sp_meta = {}
    for sp in speakers:
        t_idx = int(sp.get("trackIndex", -1))
        track_masks[t_idx] = np.zeros(num_frames, dtype=bool)
        sp_meta[t_idx] = {"priority": float(sp.get("priority", 50.0)), "name": sp.get("name") or ("speaker a%d" % (t_idx + 1))}

    audio_cache = {}
    readable = 0

    def load_audio(media_path, track_index):
        key = (media_path, int(track_index))
        if key in audio_cache:
            return audio_cache[key]
        data = None
        rate = 0
        try:
            if media_path.lower().endswith((".wav", ".aif", ".aiff", ".flac", ".ogg", ".mp3")) and os.path.isfile(media_path):
                data, rate = sf.read(media_path, dtype="float32")
            elif os.path.isfile(media_path):
                wav = extract_track_audio(media_path, track_index, temp_dir)
                if wav:
                    data, rate = sf.read(wav, dtype="float32")
            if data is not None and getattr(data, "ndim", 1) > 1:
                data = np.mean(data, axis=1)
        except Exception as e:
            print(f"[AutoPOV] could not decode {media_path}: {e}", flush=True)
            data = None
            rate = 0
        audio_cache[key] = (data, rate)
        return data, rate

    for clip in clips:
        media_path = clip.get("mediaPath")
        if not media_path or not os.path.isfile(media_path):
            continue
        try:
            c_start = float(clip.get("start", 0.0))
            c_end = float(clip.get("end", 0.0))
            c_in = float(clip.get("inPoint", 0.0))
            t_idx = int(clip.get("trackIndex", 0))
        except (TypeError, ValueError):
            continue
        if t_idx not in track_masks or c_end - c_start < 0.02:
            continue

        data, rate = load_audio(media_path, t_idx)
        if data is None or len(data) == 0:
            continue
        readable += 1

        s_idx = max(0, int(c_in * rate))
        e_idx = min(len(data), int((c_in + (c_end - c_start)) * rate))
        seg = data[s_idx:e_idx]
        if len(seg) == 0:
            continue

        hop_l = max(1, int(rate * HOP_SEC))
        win_l = max(1, int(rate * WIN_SEC))
        if len(seg) < win_l:
            peak = float(np.max(np.abs(seg)))
            if 20 * np.log10(peak + 1e-12) >= threshold_db:
                g0 = max(0, int(c_start / HOP_SEC))
                g1 = min(num_frames, int(c_end / HOP_SEC) + 1)
                track_masks[t_idx][g0:g1] = True
            continue

        frames = np.lib.stride_tricks.sliding_window_view(seg, win_l)[::hop_l]
        rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
        active = (20 * np.log10(rms)) >= threshold_db
        if not np.any(active):
            continue
        frame_secs = hop_l / rate
        indices = np.where(active)[0]
        g_first = np.clip(np.round((c_start + indices * frame_secs) / HOP_SEC).astype(int), 0, num_frames - 1)
        g_last = np.clip(np.round((c_start + (indices + 1) * frame_secs) / HOP_SEC).astype(int) + 1, 0, num_frames)
        diff = np.zeros(num_frames + 1, dtype=np.int32)
        np.add.at(diff, g_first, 1)
        np.add.at(diff, g_last, -1)
        track_masks[t_idx] |= (np.cumsum(diff)[:num_frames] > 0)

    if readable == 0:
        res = {"success": False, "error": "could not read audio from any selected speaker track (nested sequences or offline media?)."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    # Bridge short pauses per track so mid-sentence breaths don't flip the POV
    bridge_frames = max(1, int(bridge_ms / 1000.0 / HOP_SEC))
    for t_idx, mask in track_masks.items():
        gap_start = None
        for f in range(num_frames):
            if not mask[f]:
                if gap_start is None:
                    gap_start = f
            else:
                if gap_start is not None and (f - gap_start) <= bridge_frames:
                    mask[gap_start:f] = True
                gap_start = None

    # Resolve winner per frame: highest priority among active; ties go to the freshest track
    # (approximated by processing in a stable speaker order).
    speaker_order = sorted(track_masks.keys(), key=lambda k: -sp_meta[k]["priority"])  # high priority first
    assigned = -np.ones(num_frames, dtype=int)
    active_sum = np.zeros(num_frames, dtype=bool)
    for t_idx in speaker_order:
        available = track_masks[t_idx] & (assigned == -1)
        assigned[available] = t_idx
        active_sum |= track_masks[t_idx]

    # Build raw segments
    segments = []
    seg_start = None
    seg_sp = -1
    for f in range(num_frames):
        cur = assigned[f]
        if cur != seg_sp:
            if seg_sp != -1 and seg_start is not None:
                segments.append([seg_start, f, seg_sp])
            seg_start = f if cur != -1 else None
            seg_sp = cur
    if seg_sp != -1 and seg_start is not None:
        segments.append([seg_start, num_frames, seg_sp])

    # Enforce minimum shot length: absorb tiny segments into the previous one
    min_shot_frames = int((min_shot_ms / 1000.0) / HOP_SEC)
    merged = []
    for s in segments:
        if merged and (s[1] - s[0]) < min_shot_frames:
            merged[-1][1] = s[1]  # extend previous turn over the blip
        else:
            merged.append(list(s))

    out_segments = []
    for s in merged:
        a = s[0] * HOP_SEC
        b = min(timeline_end, s[1] * HOP_SEC)
        if clamp_min is not None and clamp_max is not None:
            if b <= clamp_min or a >= clamp_max:
                continue
            a = max(a, clamp_min)
            b = min(b, clamp_max)
        if b - a >= 0.08:
            out_segments.append({
                "start": round(a, 3),
                "end": round(b, 3),
                "speakerTrack": int(s[2]),
                "speakerName": sp_meta[s[2]]["name"]
            })

    print(f"[AutoPOV] detected {len(out_segments)} speaker turn(s) across {timeline_end:.1f}s.", flush=True)

    res = {
        "success": True,
        "segments": out_segments,
        "totalDuration": round(timeline_end, 3),
        "turnCount": len(out_segments)
    }
    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(res, out, indent=2)
    return res


_separation_model = None

def get_separation_model():
    """
    Lazily load the ECAPA-TDNN speaker embedding model (speechbrain).
    Windows fix: monkey-patch speechbrain's fetcher to COPY files instead of
    symlinking (symlinks need Developer Mode; copying works everywhere).
    """
    global _separation_model
    if _separation_model is None:
        print("[AutoSeparate] Loading neural speaker embedding model (ECAPA-TDNN, ~80MB, first run only)...", flush=True)
        # Windows fix: monkey-patch os.symlink, pathlib.Path.symlink_to, and speechbrain's fetcher
        # so that when speechbrain/huggingface attempts to symlink on Windows without
        # Developer Mode/Admin privileges, it seamlessly falls back to copying instead of crashing with WinError 1314.
        import pathlib
        import shutil

        _orig_symlink = getattr(os, "symlink", None)
        if _orig_symlink:
            def _safe_symlink(src, dst, target_is_directory=False, *args, **kwargs):
                try:
                    _orig_symlink(src, dst, target_is_directory=target_is_directory, *args, **kwargs)
                except OSError as e:
                    if getattr(e, "winerror", None) == 1314 or "1314" in str(e):
                        if target_is_directory or os.path.isdir(str(src)):
                            shutil.copytree(str(src), str(dst), dirs_exist_ok=True)
                        else:
                            shutil.copy2(str(src), str(dst))
                    else:
                        raise
            os.symlink = _safe_symlink

        _orig_symlink_to = getattr(pathlib.Path, "symlink_to", None)
        if _orig_symlink_to:
            def _safe_symlink_to(self, target, target_is_directory=False):
                try:
                    _orig_symlink_to(self, target, target_is_directory=target_is_directory)
                except OSError as e:
                    if getattr(e, "winerror", None) == 1314 or "1314" in str(e):
                        if target_is_directory or (isinstance(target, (str, pathlib.Path)) and pathlib.Path(target).is_dir()):
                            shutil.copytree(str(target), str(self), dirs_exist_ok=True)
                        else:
                            shutil.copy2(str(target), str(self))
                    else:
                        raise
            pathlib.Path.symlink_to = _safe_symlink_to

        try:
            from speechbrain.utils import fetching
            def _copy_not_symlink(src, dst, local_strategy=None):
                dst_p = pathlib.Path(dst)
                src_p = pathlib.Path(src)
                try:
                    if dst_p.exists() or dst_p.is_symlink():
                        dst_p.unlink()
                except OSError:
                    pass
                shutil.copy2(str(src_p), str(dst_p))
                return dst_p
            fetching.link_with_strategy = _copy_not_symlink
        except Exception:
            pass

        os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

        from speechbrain.inference.speaker import SpeakerRecognition
        savedir = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "speechbrain_spkrec")
        _separation_model = SpeakerRecognition.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=savedir,
            run_opts={"device": "cpu"},
        )
        print("[AutoSeparate] Neural speaker model ready.", flush=True)
    return _separation_model


def _extract_speaker_features(audio, sr):
    """Extract a compact speaker fingerprint from an audio segment.
    Features: 20 MFCC means + 20 MFCC stds + delta MFCC means + spectral centroid + F0 stats.
    Returns a numpy array of ~45 dimensions.
    Speed: downsample to 16kHz, cap at 4s analysis window, use yin (not pyin).
    """
    import librosa
    n_mfcc = 20

    # Cap analysis window to 4s — beyond that the features don't improve meaningfully
    max_samples = int(sr * 4)
    if len(audio) > max_samples:
        # Take from the middle of the segment for best representation
        mid = len(audio) // 2
        half = max_samples // 2
        audio = audio[max(0, mid - half):mid + half]

    # Downsample to 16kHz for feature extraction (2x faster, no meaninful loss for speech)
    if sr > 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        sr = 16000

    features = []

    # MFCCs — capture spectral envelope (vocal tract shape)
    try:
        mfccs = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=n_mfcc, n_fft=512, hop_length=256)
        features.extend(np.mean(mfccs, axis=1))   # 20 means
        features.extend(np.std(mfccs, axis=1))    # 20 stds
        delta = librosa.feature.delta(mfccs)
        features.extend(np.mean(delta, axis=1))   # 20 delta means
    except Exception:
        features.extend([0.0] * (n_mfcc * 3))

    # Spectral centroid — brightness of voice
    try:
        cent = librosa.feature.spectral_centroid(y=audio, sr=sr, n_fft=512, hop_length=256)
        features.append(float(np.mean(cent)))
        features.append(float(np.std(cent)))
    except Exception:
        features.extend([0.0, 0.0])

    # F0 (fundamental frequency) — from fast YIN, the primary discriminator
    # deep: ~80-140, neutral: ~140-220, girl: ~200-350
    try:
        f0 = librosa.yin(audio, fmin=60, fmax=400, sr=sr, frame_length=1024)
        f0_voiced = f0[f0 > 0]
        if len(f0_voiced) > 3:
            features.append(float(np.median(f0_voiced)))      # median pitch (the anchor)
            features.append(float(np.mean(f0_voiced)))        # mean pitch
            features.append(float(np.percentile(f0_voiced, 25)))  # Q1
            features.append(float(np.percentile(f0_voiced, 75)))  # Q3
            features.append(float(np.std(f0_voiced)))         # pitch variability
        else:
            features.extend([150.0, 150.0, 130.0, 170.0, 25.0])
    except Exception:
        features.extend([150.0, 150.0, 130.0, 170.0, 25.0])

    return np.array(features, dtype=np.float32)


def separate_speakers(request, output_path):
    """
    Multi-layer speaker diarization:
      1. VAD — energy-based voice activity detection
      2. Embedding — speechbrain ECAPA-TDNN voice fingerprint per segment
      3. Pitch — librosa F0 statistics (deep/neutral/girl disambiguation)
      4. Clustering — sklearn agglomerative with known N speakers
      5. Confidence — re-assign low-silhouette segments to nearest centroid
      6. Smoothing — merge adjacent same-speaker segments, enforce minimum duration
    """
    wav_path = request.get("wavPath")
    if not wav_path or not os.path.isfile(wav_path):
        res = {"success": False, "error": f"Audio file not found: {wav_path}"}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    num_speakers = int(request.get("numSpeakers", 2))
    num_speakers = max(1, min(16, num_speakers))
    threshold_db = float(request.get("threshold", -38.0))
    min_speech_ms = float(request.get("minSpeechMs", 300.0))
    min_silence_ms = float(request.get("minSilenceMs", 200.0))
    margin_ms = float(request.get("marginMs", 80.0))
    scope = request.get("scope", "entire")
    seq_in = float(request.get("seqInPoint", 0.0))
    seq_out = float(request.get("seqOutPoint", 0.0))

    # ── Load audio ──────────────────────────────────────────────
    data, rate = sf.read(wav_path, dtype="float32")
    if data.ndim > 1:
        data = np.mean(data, axis=1)
    total_duration = len(data) / rate
    print(f"[AutoSeparate] Loaded {wav_path} ({total_duration:.1f}s, {rate}Hz)", flush=True)

    # ── Layer 1: VAD — detect speech segments ───────────────────
    hop = int(rate * 0.01)  # 10ms
    win = int(rate * 0.025)  # 25ms
    num_frames = max(1, (len(data) - win) // hop)
    frames_db = np.zeros(num_frames, dtype=np.float32)
    for f in range(num_frames):
        chunk = data[f * hop : f * hop + win]
        rms = np.sqrt(np.mean(chunk ** 2))
        frames_db[f] = 20 * np.log10(rms + 1e-12)

    is_talk = frames_db >= threshold_db

    # Bridge short pauses (<= min_silence_ms)
    bridge_frames = int((min_silence_ms / 1000.0) / 0.01)
    gap_start = None
    for f in range(num_frames):
        if not is_talk[f]:
            if gap_start is None:
                gap_start = f
        else:
            if gap_start is not None and (f - gap_start) <= bridge_frames:
                is_talk[gap_start:f] = True
            gap_start = None

    # Collect contiguous speech segments
    raw_segs = []
    seg_start = None
    for f in range(num_frames):
        if is_talk[f]:
            if seg_start is None:
                seg_start = f
        else:
            if seg_start is not None:
                raw_segs.append((seg_start, f))
                seg_start = None
    if seg_start is not None:
        raw_segs.append((seg_start, num_frames))

    min_speech_frames = int((min_speech_ms / 1000.0) / 0.01)
    speech_segs = [(s, e) for s, e in raw_segs if (e - s) >= min_speech_frames]

    print(f"[AutoSeparate] VAD: {len(speech_segs)} speech segment(s) after bridging.", flush=True)

    if len(speech_segs) == 0:
        res = {"success": False, "error": "No speech detected above threshold. Lower the threshold or check the track."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    # ── Layer 2: Neural speaker embeddings (ECAPA-TDNN) ───────────
    # True voice fingerprints — separate speakers by TIMBRE (vocal tract identity),
    # not pitch. This is what makes separation robust when the neutral voice goes
    # high or low: the voice identity doesn't change.
    print(f"[AutoSeparate] Extracting neural voice fingerprints for {len(speech_segs)} speech segment(s)...", flush=True)
    import librosa
    model = get_separation_model()

    embeddings = []
    seg_valid = []
    for idx, (sf_frame, ef_frame) in enumerate(speech_segs):
        s_sample = max(0, sf_frame * hop - int(rate * margin_ms / 1000.0))
        e_sample = min(len(data), ef_frame * hop + win + int(rate * margin_ms / 1000.0))
        seg_audio = data[s_sample:e_sample]
        if len(seg_audio) < int(rate * 0.3):
            continue
        # Cap at 4 seconds (middle of segment) — enough for a stable 192-dim embedding
        max_samps = int(rate * 4)
        if len(seg_audio) > max_samps:
            mid = len(seg_audio) // 2
            seg_audio = seg_audio[mid - max_samps // 2 : mid + max_samps // 2]
        # Resample to 16kHz for the model
        if rate != 16000:
            seg_audio = librosa.resample(seg_audio, orig_sr=rate, target_sr=16000)
        seg_tensor = torch.from_numpy(seg_audio.astype("float32")).unsqueeze(0)
        try:
            with torch.no_grad():
                emb = model.encode_batch(seg_tensor).squeeze().cpu().numpy().flatten()
            embeddings.append(emb.astype(np.float32))
            seg_valid.append(si0 if False else idx)
        except Exception as e:
            print(f"[AutoSeparate] embedding failed for segment {idx}: {e}", flush=True)
        if idx % 25 == 0 and idx > 0:
            print(f"[AutoSeparate] ... {idx}/{len(speech_segs)} embeddings done", flush=True)

    if len(embeddings) < num_speakers:
        res = {"success": False, "error": f"Only {len(embeddings)} valid speech segment(s) found, but {num_speakers} speakers requested. Need more speech data."}
        with open(output_path, "w", encoding="utf-8") as out:
            json.dump(res, out, indent=2)
        return res

    emb_matrix = np.array(embeddings, dtype=np.float32)  # (N_segs, 65)
    print(f"[AutoSeparate] Computed {emb_matrix.shape[0]} feature vectors, dim={emb_matrix.shape[1]}.", flush=True)

    # ── Layer 3: F0-based primary clustering ──────────────────────
    # For deep/neutral/girl speakers, F0 is THE discriminator.
    # Deep: ~80-140 Hz, Neutral: ~140-220 Hz, Girl: ~200-350 Hz.
    # Extract F0 stats from the features (indices 62-66 are the F0 values).
    F0_IDX_START = 60  # 20+20+20 = 60 MFCC dims, +2 spectral, then 5 F0 dims at 62-66

    # Get F0 medians for each segment (from feature vector index 60)
    # Actually indices: 0-19 mfcc_mean, 20-39 mfcc_std, 40-59 mfcc_delta_mean,
    # 60-61 spectral, 62=f0_median, 63=f0_mean, 64=f0_q1, 65=f0_q3
    f0_medians = emb_matrix[:, 62]   # median pitch per segment
    f0_q75s = emb_matrix[:, 65]     # Q3 pitch (detects high-range segments)

    # Remove layers 3 & 4 from before - replaced by cleaner hierarchical approach

    # ── Layer 4: Clustering with F0 as primary ───────────────────
    # Strategy: use log-F0 (perceptually linear) as the primary clustering dim,
    # MFCC+spectral as verification. GMM handles arbitrary cluster shapes better
    # than agglomerative for 1-5 speakers with distinct pitch ranges.

    from sklearn.mixture import GaussianMixture
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import silhouette_score

    # Log-F0 (perceptually linear spacing between octaves)
    log_f0 = np.log2(np.maximum(f0_medians, 1.0)).reshape(-1, 1)

    # Weight: F0 dominates (this IS the primary speaker discriminator)
    # Log-F0 has natural scale differences between voice types
    # Scale to comparable range with MFCCs
    scaler_f0 = StandardScaler()
    X_f0 = scaler_f0.fit_transform(log_f0)  # (N, 1)

    # MFCC features: still normalize but DON'T use them for primary split
    # They'll be used as verification, not clustering input
    scaler_mfcc = StandardScaler()
    mfcc_norm = scaler_mfcc.fit_transform(emb_matrix[:, :62])  # (N, 62)

    # Combined clustering input: F0 (primary, high weight) + MFCC (secondary, low weight)
    # F0 weight=3 means pitch differences dominate the distance metric
    # Pass float64 for superior numerical accuracy in covariance calculations
    X_cluster = np.hstack([X_f0 * 3.0, mfcc_norm[:, :20] * 1.0]).astype(np.float64)  # 1*3 + 20*1 = 21 dims

    # Ensure num_speakers does not exceed available speech segments
    num_speakers = max(1, min(num_speakers, len(X_cluster)))

    labels = None
    probs = None

    # Multi-tier clustering strategy:
    # 1. GMM with reg_covar=1e-2 to prevent covariance collapse on near-identical/singleton samples
    # 2. GMM with reg_covar=1e-1
    # 3. KMeans fallback (strictly distance-based, immune to covariance collapse)
    for reg in [1e-2, 1e-1]:
        try:
            gmm = GaussianMixture(
                n_components=num_speakers,
                covariance_type="diag",
                reg_covar=reg,
                n_init=5,
                max_iter=300,
                random_state=42,
            )
            labels = gmm.fit_predict(X_cluster)
            probs = gmm.predict_proba(X_cluster)
            break
        except Exception as egmm:
            print(f"[AutoSeparate] GMM reg={reg} failed: {egmm}", flush=True)

    if labels is None or probs is None:
        from sklearn.cluster import KMeans
        print(f"[AutoSeparate] Falling back to robust KMeans clustering ({num_speakers} clusters)...", flush=True)
        km = KMeans(n_clusters=num_speakers, n_init=10, random_state=42)
        labels = km.fit_predict(X_cluster)
        dists = km.transform(X_cluster)
        exp_d = np.exp(-dists)
        probs = exp_d / np.maximum(exp_d.sum(axis=1, keepdims=True), 1e-9)

    # ── Layer 5: Confidence — re-assign low-confidence segments ─
    max_probs = np.max(probs, axis=1)
    
    if len(labels) > num_speakers and len(set(labels)) > 1:
        sil_score = silhouette_score(X_cluster, labels, metric="euclidean")
    else:
        sil_score = 1.0

    # Reassign segments with low confidence (< 0.7) to their best alternative cluster
    centroids = np.zeros((num_speakers, X_cluster.shape[1]), dtype=np.float32)
    counts = np.zeros(num_speakers, dtype=np.int32)
    for i, lbl in enumerate(labels):
        centroids[lbl] += X_cluster[i]
        counts[lbl] += 1
    for c in range(num_speakers):
        if counts[c] > 0:
            centroids[c] /= counts[c]

    reassigned = 0
    for i in range(len(labels)):
        if max_probs[i] < 0.7:  # low confidence
            dists = [float(np.linalg.norm(X_cluster[i] - centroids[c])) for c in range(num_speakers)]
            best_c = int(np.argmin(dists))
            if best_c != labels[i]:
                labels[i] = best_c
                reassigned += 1

    if reassigned > 0:
        print(f"[AutoSeparate] Confidence layer: re-assigned {reassigned} segment(s).", flush=True)

    # ── Build raw speaker segments ──────────────────────────────
    # Map each speech segment to its cluster label, then merge adjacent same-speaker segments.
    raw_turns = []
    for idx, si in enumerate(seg_valid):
        sf_frame, ef_frame = speech_segs[si]
        start_sec = (sf_frame * hop) / rate
        end_sec = min(total_duration, (ef_frame * hop + win) / rate)
        f0_val = round(float(f0_medians[idx]), 1)  # already in Hz from feature vector
        raw_turns.append({
            "start": round(start_sec, 3),
            "end": round(end_sec, 3),
            "speaker": int(labels[idx]),
            "f0": f0_val,
        })

    # ── Layer 6: Smoothing ──────────────────────────────────────
    # Merge adjacent segments of the same speaker.
    min_gap_sec = 0.5  # merge if same speaker with < 0.5s gap
    merged_turns = []
    for t in raw_turns:
        if merged_turns and merged_turns[-1]["speaker"] == t["speaker"] and (t["start"] - merged_turns[-1]["end"]) < min_gap_sec:
            merged_turns[-1]["end"] = t["end"]
        else:
            merged_turns.append(dict(t))

    # Enforce minimum segment duration — absorb sub-minimum segments into previous.
    min_dur_sec = min_speech_ms / 1000.0
    smoothed = []
    for t in merged_turns:
        if smoothed and (t["end"] - t["start"]) < min_dur_sec:
            smoothed[-1]["end"] = t["end"]
        else:
            smoothed.append(dict(t))

    # Clamp to scope (in/out)
    if scope == "inout" and seq_out > seq_in:
        clamped = []
        for t in smoothed:
            s = max(t["start"], seq_in)
            e = min(t["end"], seq_out)
            if e - s >= min_dur_sec:
                clamped.append({"start": round(s, 3), "end": round(e, 3), "speaker": t["speaker"], "f0": t["f0"]})
        smoothed = clamped

    # Build per-speaker summary
    speaker_summary = []
    for c in range(num_speakers):
        segs = [t for t in smoothed if t["speaker"] == c]
        total_spoken = sum(t["end"] - t["start"] for t in segs)
        avg_f0 = np.mean([t["f0"] for t in segs]) if segs else 0
        voice_type = "deep" if avg_f0 < 130 else ("neutral" if avg_f0 < 200 else "high/girl")
        speaker_summary.append({
            "speaker": c,
            "segments": len(segs),
            "totalSpoken": round(total_spoken, 2),
            "avgF0": round(float(avg_f0), 1),
            "voiceType": voice_type,
        })

    print(f"[AutoSeparate] Done: {len(smoothed)} segment(s), {num_speakers} speaker(s), silhouette={sil_score:.3f}", flush=True)

    res = {
        "success": True,
        "segments": smoothed,
        "numSpeakers": num_speakers,
        "speakerSummary": speaker_summary,
        "totalDuration": round(total_duration, 3),
        "silhouetteScore": round(float(sil_score), 3),
        "reassignedCount": reassigned,
    }
    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(res, out, indent=2)
    return res


if __name__ == "__main__":
    output_path = sys.argv[2] if len(sys.argv) >= 3 else sys.argv[1].replace(".json", "_out.json")
    try:
        with open(sys.argv[1], "r", encoding="utf-8") as rf:
            req_data = json.load(rf)
        mode = req_data.get("mode", "heads")
        if mode == "analyze_silences":
            analyze_timeline_silences(req_data, output_path)
        elif mode == "analyze_silences_from_clips":
            analyze_silences_from_clips(req_data, output_path)
        elif mode == "analyze_pov_turns":
            analyze_pov_turns(req_data, output_path)
        elif mode == "separate_speakers":
            separate_speakers(req_data, output_path)
        elif mode == "calculate_noise_floor":
            calculate_ambient_noise_floor(req_data, output_path)
        elif mode == "auto_ai_voice":
            auto_ai_voice_pipeline(req_data, output_path)
        elif mode == "slice_sfx":
            slice_sfx(req_data, output_path)
        elif mode == "prep_ai_voice":
            prep_ai_voice(req_data, output_path)
        elif mode == "elevenlabs_sts":
            generate_elevenlabs_sts(req_data, output_path)
        elif mode == "sfx":
            run_sfx_prediction(sys.argv[1], output_path)
        else:
            run_pipeline(sys.argv[1], output_path)
    except Exception as error:
        print("[AI] Fatal error: %s" % error, file=sys.stderr, flush=True)
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        with open(output_path, "w", encoding="utf-8") as output_file:
            json.dump({"success": False, "error": str(error), "events": []}, output_file)
        sys.exit(1)
