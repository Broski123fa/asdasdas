LOCAL AI STUDIO
===============

WHAT RUNS LOCALLY
-----------------
- Model inference runs in the browser using WebGPU through @mlc-ai/web-llm.
- Prompts and saved conversations are not sent to a model inference server.
- Chat history and the Knowledge & Solved Cases thread are stored in this browser's localStorage.
- The three bundled model weight sets are approximately 196 MB, 267 MB, and 674 MB. Actual runtime memory use varies by browser, GPU, and available memory.

RUNNING THE APP
---------------
Use the Replit Preview, or run `python3 main.py` from the project directory in an environment with Python 3. The server serves the static app and supplies the COOP/COEP headers needed for cross-origin isolation.

On a Chromebook, inference does not require Linux, SSH, or a separate model server. The app files still need to be delivered from an HTTPS or localhost origin; opening index.html directly with file:// does not provide the required WebGPU and isolation features. If hosting the project elsewhere, configure the host to send:

  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

LIMITS TO OFFLINE USE
--------------------
The model weight folders are bundled with this project, but the WebLLM JavaScript runtime is imported from a CDN. The first model load also requires the app files and runtime dependencies to be available. Browser caching is managed by WebLLM and the browser; this project cannot guarantee that every dependency is stored in IndexedDB or that a future visit will work without any network access. For a genuinely offline setup, bundle and cache the runtime dependencies on the same origin and test offline startup on the target Chromebook.

MODEL GUIDE
-----------
- SmolLM2 360M: fast Q&A, grammar edits, and formatting.
- Qwen 2.5 0.5B: code generation, math, debugging, and structured data.
- Llama 3.2 1B: detailed reasoning, essay drafts, and explanations.

The memory figures in the interface describe the approximate bundled weight size, not a guarantee of total GPU or system RAM use.
