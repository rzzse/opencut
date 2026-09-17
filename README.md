# OpenCut

A free, open-source Adobe Premiere Pro extension that automates editing workflows using AI. Built as a CEP (Common Extensibility Platform) panel.

## Features

### 🎬 Auto Character Heads
Automatically sync speaker reaction head overlays to your timeline. Detects who's speaking via audio analysis and places character expression PNGs with motion presets.

### ✂️ Auto Cut Silences
AI-powered silence detection and removal. Analyzes audio energy levels to find dead air, then automatically removes silence gaps from your timeline.

### 🗣️ Auto Separate Speakers
Speaker diarization powered by SpeechBrain. Detects individual speakers in a multi-person recording and separates them onto individual audio tracks — completely non-destructive (source track is never modified).

### 🔊 Auto Sound Effects
AI-suggested sound effect placement. Analyzes your audio for emotional cues and places sound effects at contextually appropriate moments.

### 🎤 AI Voice (ElevenLabs Integration)
Speech-to-speech voice conversion. Export dialogue, convert it to a character voice via ElevenLabs, and resync the AI audio onto your timeline with frame-accurate alignment.

### 📐 POV Switch
Automated POV/camera angle switching based on speaker detection. Razors and toggles between camera tracks at speaker turn boundaries.

## Installation

### Prerequisites
- **Adobe Premiere Pro** 2020 or later (CC 2020+)
- **Python 3.10+** (for AI features)
- **CEP debugging enabled** (see below)

### Enable CEP Extensions
1. Open the Registry Editor (`regedit`)
2. Navigate to `HKEY_CURRENT_USER\Software\Adobe\CSXS.11` (version number may vary)
3. Create a String value called `PlayerDebugMode` and set it to `1`
4. Restart Premiere Pro

### Install the Extension
1. Clone or download this repository
2. Copy the folder to your CEP extensions directory:
   ```
   Windows: C:\Users\<USERNAME>\AppData\Roaming\Adobe\CEP\extensions\com.opencut.panel
   Mac:     ~/Library/Application Support/Adobe/CEP/extensions/com.opencut.panel
   ```
3. Install Python dependencies:
   ```bash
   pip install torch torchaudio speechbrain scikit-learn scipy numpy
   ```
4. Open Premiere Pro → Window → **OpenCut**

### Python Path Configuration
By default, OpenCut looks for Python at `C:\Program Files\Python313\python.exe`. If your Python is installed elsewhere, update the `python` variable in `js/main.js` (search for `var python =`).

## Configuration

### Character Head Folders
Configure character head PNG folders through the extension UI. Each character folder should contain emotion-tagged PNG files (e.g., `happy.png`, `sad.png`, `angry.png`).

### Sound Effects
Add your own SFX files by editing the `sfxLibrary` array in `js/main.js`:
```javascript
var sfxLibrary = [
    { id:"sfx_1", name:"boom.wav", tag:"dramatic", duration:1.8, path:"C:/path/to/boom.wav" }
];
```

### ElevenLabs API Key
To use AI voice conversion, enter your ElevenLabs API key in the extension's AI Voice settings panel. Get a key at [elevenlabs.io](https://elevenlabs.io).

## Architecture

```
com.opencut.panel/
├── CSXS/manifest.xml          # CEP extension manifest
├── index.html                 # Panel UI (HTML/CSS)
├── css/
│   ├── style.css              # Main styles
│   └── cobalt.css             # Color theme
├── js/
│   └── main.js                # Frontend logic, button handlers, AI orchestration
├── jsx/
│   └── hostscript.jsx         # ExtendScript — all Premiere Pro timeline manipulation
├── ai_processor.py            # Python AI backend (VAD, speaker diarization, clustering)
└── assets/                    # Character PNGs and brand assets
```

### Data Flow
1. **UI** (`index.html` + `js/main.js`) — User interactions and orchestration
2. **ExtendScript** (`jsx/hostscript.jsx`) — Direct Premiere Pro API calls (timeline editing, clip placement, track creation)
3. **Python AI** (`ai_processor.py`) — Audio analysis, silence detection, speaker diarization via SpeechBrain + scikit-learn

## License

MIT — see [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! Please open an issue or pull request.
