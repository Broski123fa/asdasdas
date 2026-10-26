const STORAGE_KEY = "ai_chat_history";
const KNOWLEDGE_ID = "knowledge_solved_cases";

const MODELS = {
  "SmolLM2-360M-Instruct-q4f16_1-MLC": {
    tag: "FAST · 360M",
    weightSize: "~196 MB",
    description: "Quick Q&A, grammar edits, and low-latency formatting.",
  },
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": {
    tag: "CODE & LOGIC · 0.5B",
    weightSize: "~267 MB",
    description: "Code generation, math, debugging, and structured data.",
  },
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": {
    tag: "REASONING · 1B",
    weightSize: "~674 MB",
    description: "More detailed reasoning, essay drafts, and explanations.",
  },
};

// These model directories contain MLC weights and configuration. WebLLM supplies
// the browser runtime; requests never send prompts to a model inference server.
const appConfig = {
  model_list: Object.keys(MODELS).map((modelId) => ({
    model: `./${modelId}/`,
    model_id: modelId,
  })),
};

let engine = null;
let activeModelId = null;
let chats = readChats();
let currentChatId = null;
let isGenerating = false;
let storageAvailable = true;

document.addEventListener("DOMContentLoaded", initialize, { once: true });

function initialize() {
  const modelSelect = document.getElementById("modelSelect");
  document.getElementById("newChatBtn").addEventListener("click", createNewChat);
  document.getElementById("loadBtn").addEventListener("click", initEngine);
  document.getElementById("message-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });
  document.getElementById("userInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  document.getElementById("userInput").addEventListener("input", resizeComposer);
  modelSelect.addEventListener("change", updateModelDetails);

  ensureKnowledgeThread();
  updateModelDetails();
  renderHistoryList();
  const firstChat = chats.find((chat) => chat.id !== KNOWLEDGE_ID);
  if (firstChat) selectChat(firstChat.id);
  else createNewChat();
  checkBrowserCapabilities();
}

function readChats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((chat) =>
          chat &&
          typeof chat.id === "string" &&
          typeof chat.title === "string" &&
          Array.isArray(chat.messages)
        )
      : [];
  } catch (error) {
    console.warn("Saved chat history could not be read.", error);
    return [];
  }
}

function ensureKnowledgeThread() {
  let knowledge = chats.find((chat) => chat.id === KNOWLEDGE_ID);
  if (!knowledge) {
    knowledge = {
      id: KNOWLEDGE_ID,
      title: "Knowledge & Solved Cases",
      messages: [],
      isSystem: true,
    };
    chats.unshift(knowledge);
  } else {
    knowledge.title = "Knowledge & Solved Cases";
    knowledge.isSystem = true;
  }
  saveChats();
}

function saveChats() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    storageAvailable = true;
    document.getElementById("storage-status").textContent =
      "Conversations are saved on this device.";
    return true;
  } catch (error) {
    storageAvailable = false;
    console.error("Could not save local conversations.", error);
    document.getElementById("storage-status").textContent =
      "Storage is full or unavailable. Chats may not persist.";
    setStatus("Browser storage is unavailable or full. Export or remove old chats to free space.", "error");
    return false;
  }
}

function createNewChat() {
  const newChat = {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: "New chat",
    messages: [],
  };
  chats.splice(1, 0, newChat);
  saveChats();
  selectChat(newChat.id);
}

function renderHistoryList() {
  const list = document.getElementById("history-list");
  list.replaceChildren();
  const knowledge = chats.find((chat) => chat.id === KNOWLEDGE_ID);
  const orderedChats = [knowledge, ...chats.filter((chat) => chat.id !== KNOWLEDGE_ID)].filter(Boolean);

  for (const chat of orderedChats) {
    const item = document.createElement("div");
    item.className = `history-item${chat.id === currentChatId ? " active" : ""}`;
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "history-open";
    openButton.setAttribute("aria-current", chat.id === currentChatId ? "page" : "false");
    openButton.addEventListener("click", () => selectChat(chat.id));

    const icon = document.createElement("span");
    icon.className = "history-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = chat.id === KNOWLEDGE_ID ? "◆" : "◷";

    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = chat.id === KNOWLEDGE_ID
      ? `${chat.title} · ${Math.floor(chat.messages.length / 2)}`
      : chat.title || "New chat";

    openButton.append(icon, title);
    item.append(openButton);

    if (chat.id !== KNOWLEDGE_ID) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-btn";
      deleteButton.setAttribute("aria-label", `Delete ${chat.title || "chat"}`);
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteChat(chat.id);
      });
      item.append(deleteButton);
    }
    list.append(item);
  }

  const chatCount = chats.filter((chat) => chat.id !== KNOWLEDGE_ID).length;
  document.getElementById("chat-count").textContent = String(chatCount);
}

function selectChat(id) {
  const chat = chats.find((item) => item.id === id);
  if (!chat) return;
  currentChatId = id;
  renderHistoryList();
  renderCurrentMessages();
  const knowledgeMode = id === KNOWLEDGE_ID;
  const input = document.getElementById("userInput");
  input.disabled = !engine || knowledgeMode || isGenerating;
  input.placeholder = knowledgeMode
    ? "Knowledge is built by saving useful answers from your conversations."
    : engine
      ? "Ask a question…"
      : "Load a model to start a conversation…";
  document.getElementById("sendBtn").disabled = !engine || knowledgeMode || isGenerating;
}

function deleteChat(id) {
  if (id === KNOWLEDGE_ID) return;
  if (isGenerating && currentChatId === id) {
    setStatus("Wait for this response to finish before deleting the active chat.", "error");
    return;
  }
  chats = chats.filter((chat) => chat.id !== id);
  saveChats();
  if (currentChatId === id) {
    const nextChat = chats.find((chat) => chat.id !== KNOWLEDGE_ID);
    if (nextChat) selectChat(nextChat.id);
    else createNewChat();
  } else {
    renderHistoryList();
  }
}

function renderCurrentMessages() {
  const container = document.getElementById("chat-container");
  container.replaceChildren();
  const currentChat = chats.find((chat) => chat.id === currentChatId);
  if (!currentChat) return;

  if (!currentChat.messages.length) {
    const welcome = document.createElement("div");
    welcome.className = "welcome";
    const mark = document.createElement("div");
    mark.className = "welcome-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = currentChat.id === KNOWLEDGE_ID ? "◆" : "✳";
    const heading = document.createElement("h2");
    heading.textContent = currentChat.id === KNOWLEDGE_ID
      ? "Knowledge & Solved Cases"
      : "A private workspace for your ideas";
    const copy = document.createElement("p");
    copy.textContent = currentChat.id === KNOWLEDGE_ID
      ? "Save useful answers from a conversation and they’ll be available as context in future chats."
      : "Choose a model above to begin. Your messages are processed in this browser and are not sent to an inference server.";
    welcome.append(mark, heading, copy);
    container.append(welcome);
    return;
  }

  currentChat.messages.forEach((message, index) => {
    const previousUserMessage = currentChat.messages
      .slice(0, index)
      .reverse()
      .find((item) => item.role === "user");
    appendMessageUI(message.role, message.content, {
      question: previousUserMessage?.content,
      allowSave: currentChat.id !== KNOWLEDGE_ID && message.role === "assistant",
    });
  });
  container.scrollTop = container.scrollHeight;
}

function appendMessageUI(role, text, options = {}) {
  const container = document.getElementById("chat-container");
  const message = document.createElement("article");
  message.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "YOU" : role === "knowledge" ? "KB" : "AI";

  const content = document.createElement("div");
  content.className = "message-content";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  content.append(bubble);

  if (options.allowSave && options.question && text && text !== "Thinking…") {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "save-knowledge-btn";
    saveButton.textContent = "＋ Save to knowledge";
    saveButton.addEventListener("click", () => {
      const saved = addKnowledgeCase(options.question, text);
      if (saved) {
        saveButton.textContent = "Saved to knowledge";
        saveButton.disabled = true;
      }
    });
    actions.append(saveButton);
    content.append(actions);
  }

  message.append(avatar, content);
  container.append(message);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

function addKnowledgeCase(question, answer) {
  const knowledge = chats.find((chat) => chat.id === KNOWLEDGE_ID);
  if (!knowledge) return false;
  const cleanQuestion = question.trim();
  const cleanAnswer = answer.trim();
  if (!cleanQuestion || !cleanAnswer) return false;

  const duplicate = knowledge.messages.some((message, index) =>
    message.role === "user" &&
    message.content === cleanQuestion &&
    knowledge.messages[index + 1]?.content === cleanAnswer
  );
  if (duplicate) {
    setStatus("That solved case is already in your knowledge thread.", "success");
    return true;
  }

  knowledge.messages.push(
    { role: "user", content: cleanQuestion },
    { role: "assistant", content: cleanAnswer }
  );
  const caseCount = Math.floor(knowledge.messages.length / 2);
  if (caseCount > 30) knowledge.messages.splice(0, (caseCount - 30) * 2);
  saveChats();
  renderHistoryList();
  if (currentChatId === KNOWLEDGE_ID) renderCurrentMessages();
  setStatus("Saved. This solved case will be included in future prompts.", "success");
  return true;
}

function getKnowledgeContext() {
  const knowledge = chats.find((chat) => chat.id === KNOWLEDGE_ID);
  if (!knowledge?.messages?.length) return "";

  const cases = [];
  for (let index = 0; index < knowledge.messages.length - 1; index += 2) {
    const question = knowledge.messages[index];
    const answer = knowledge.messages[index + 1];
    if (question?.role === "user" && answer?.role === "assistant") {
      cases.push({
        question: question.content.slice(0, 650),
        answer: answer.content.slice(0, 1100),
      });
    }
  }
  const recentCases = cases.slice(-6);
  if (!recentCases.length) return "";

  const notes = recentCases.map((item, index) =>
    `${index + 1}. Previous question: ${item.question}\nSaved solution: ${item.answer}`
  );
  return [
    "Use these saved solved cases as optional reference when relevant. They may be incomplete; prioritize the current user's request and do not force unrelated cases into the answer.",
    ...notes,
  ].join("\n\n");
}

function updateModelDetails() {
  const modelId = document.getElementById("modelSelect").value;
  const model = MODELS[modelId];
  if (!model) return;
  document.getElementById("model-tag").textContent = model.tag;
  document.getElementById("model-memory").textContent = model.weightSize;
  document.getElementById("model-description").textContent = model.description;
}

async function checkBrowserCapabilities() {
  const chip = document.getElementById("runtime-chip");
  const label = document.getElementById("runtime-label");
  const alert = document.getElementById("gpu-alert");
  const problems = [];

  if (!window.isSecureContext) {
    problems.push("Open this app from HTTPS or localhost; direct file:// launch does not provide the browser features WebGPU needs.");
  }
  if (!navigator.gpu) {
    problems.push("WebGPU is not available. Use a current ChromeOS Chrome browser and check chrome://flags/#enable-unsafe-webgpu if your device requires the flag, then relaunch Chrome.");
  } else {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) problems.push("Chrome did not find a compatible GPU adapter. Check ChromeOS updates, hardware acceleration, and WebGPU availability.");
    } catch (error) {
      console.warn("WebGPU adapter check failed.", error);
      problems.push("Chrome could not initialize a WebGPU adapter. Check browser GPU settings and restart Chrome.");
    }
  }
  if (!crossOriginIsolated) {
    problems.push("This page is not cross-origin isolated. Serve it with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.");
  }

  if (problems.length) {
    chip.dataset.state = "warning";
    label.textContent = navigator.gpu ? "WebGPU setup needed" : "WebGPU unavailable";
    alert.hidden = false;
    alert.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = "Browser setup needed: ";
    alert.append(strong, document.createTextNode(problems.join(" ")));
  } else {
    chip.dataset.state = "ready";
    label.textContent = "WebGPU ready";
    alert.hidden = true;
  }
}

async function initEngine() {
  const selectedModel = document.getElementById("modelSelect").value;
  const loadButton = document.getElementById("loadBtn");
  const progress = document.getElementById("progress");
  const input = document.getElementById("userInput");
  const sendButton = document.getElementById("sendBtn");
  if (!MODELS[selectedModel]) return;

  loadButton.disabled = true;
  input.disabled = true;
  sendButton.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  setStatus(`Checking local model files for ${selectedModel}…`);

  try {
    if (!window.isSecureContext) {
      throw new Error("WebGPU requires HTTPS or localhost. Do not open index.html as a file.");
    }
    if (!navigator.gpu) {
      throw new Error("WebGPU is unavailable in this browser. Check ChromeOS/Chrome support and GPU settings.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No compatible WebGPU adapter was found.");
    if (!crossOriginIsolated) {
      throw new Error("Cross-origin isolation is missing. Serve this site with COOP same-origin and COEP require-corp headers.");
    }

    const configResponse = await fetch(`./${selectedModel}/mlc-chat-config.json`, { cache: "no-store" });
    if (!configResponse.ok) {
      throw new Error(`The local model configuration could not be found (${configResponse.status}). Check that the model folder is served with the app.`);
    }
    const modelConfig = await configResponse.json();
    if (!modelConfig.model_type || !modelConfig.quantization) {
      throw new Error("The local model configuration is incomplete.");
    }

    setStatus(`Loading ${selectedModel} into browser memory. The first load may take a while…`);
    const webllm = await import("https://esm.run/@mlc-ai/web-llm");
    if (engine && typeof engine.unload === "function") {
      try {
        await engine.unload();
      } catch (unloadError) {
        console.warn("The previous model could not be explicitly unloaded.", unloadError);
      }
    }
    engine = await webllm.CreateMLCEngine(selectedModel, {
      appConfig,
      initProgressCallback: (report) => {
        if (report?.text) setStatus(report.text);
        if (Number.isFinite(report?.progress)) {
          progress.value = Math.max(0, Math.min(100, report.progress * 100));
        }
      },
    });
    activeModelId = selectedModel;
    progress.hidden = true;
    setStatus(`${selectedModel} is ready. Inference runs in this browser.`, "success");
    document.getElementById("runtime-chip").dataset.state = "ready";
    document.getElementById("runtime-label").textContent = "Model ready";
    if (currentChatId !== KNOWLEDGE_ID) input.disabled = false;
    input.placeholder = currentChatId === KNOWLEDGE_ID
      ? "Knowledge is built by saving useful answers from your conversations."
      : "Ask a question…";
    sendButton.disabled = currentChatId === KNOWLEDGE_ID;
  } catch (error) {
    console.error("Model initialization failed.", error);
    progress.hidden = true;
    engine = null;
    activeModelId = null;
    setStatus(error instanceof Error ? error.message : "Model initialization failed.", "error");
    const chip = document.getElementById("runtime-chip");
    chip.dataset.state = "error";
    document.getElementById("runtime-label").textContent = "Model not loaded";
  } finally {
    loadButton.disabled = false;
  }
}

async function sendMessage() {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  const currentChat = chats.find((chat) => chat.id === currentChatId);
  if (!text || !engine || !currentChat || currentChat.id === KNOWLEDGE_ID || isGenerating) return;

  if (currentChat.messages.length === 0) {
    currentChat.title = text.length > 32 ? `${text.slice(0, 32).trim()}…` : text;
    renderHistoryList();
  }

  currentChat.messages.push({ role: "user", content: text });
  appendMessageUI("user", text);
  input.value = "";
  resizeComposer();
  saveChats();

  isGenerating = true;
  input.disabled = true;
  document.getElementById("sendBtn").disabled = true;
  const aiBubble = appendMessageUI("assistant", "Thinking…");
  const messages = [];
  const knowledgeContext = getKnowledgeContext();
  if (knowledgeContext) messages.push({ role: "system", content: knowledgeContext });
  messages.push(...currentChat.messages.map((message) => ({
    role: message.role,
    content: message.content,
  })));

  try {
    const chunks = await engine.chat.completions.create({
      model: activeModelId,
      messages,
      stream: true,
    });
    let fullResponse = "";
    for await (const chunk of chunks) {
      fullResponse += chunk.choices?.[0]?.delta?.content || "";
      aiBubble.textContent = fullResponse || "Thinking…";
      const container = document.getElementById("chat-container");
      container.scrollTop = container.scrollHeight;
    }
    if (!fullResponse.trim()) throw new Error("The model returned an empty response. Try again with a shorter prompt.");
    currentChat.messages.push({ role: "assistant", content: fullResponse });
    saveChats();
    if (currentChatId === currentChat.id) {
      const previousQuestion = currentChat.messages
        .slice(0, -1)
        .reverse()
        .find((message) => message.role === "user")?.content;
      const messageNode = aiBubble.closest(".message");
      addSaveAction(messageNode, previousQuestion, fullResponse);
    }
    setStatus("Response complete.", "success");
  } catch (error) {
    console.error("Response generation failed.", error);
    const reason = error instanceof Error ? error.message : "Unknown generation error.";
    aiBubble.textContent = `Response failed: ${reason}`;
    aiBubble.setAttribute("role", "alert");
    setStatus("Response failed. Your question is still saved; you can retry.", "error");
  } finally {
    isGenerating = false;
    if (currentChatId !== KNOWLEDGE_ID) {
      input.disabled = !engine;
      document.getElementById("sendBtn").disabled = !engine;
    }
    input.focus();
  }
}

function addSaveAction(messageNode, question, answer) {
  if (!messageNode || !question || !answer || messageNode.querySelector(".message-actions")) return;
  const content = messageNode.querySelector(".message-content");
  if (!content) return;
  const actions = document.createElement("div");
  actions.className = "message-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "save-knowledge-btn";
  button.textContent = "＋ Save to knowledge";
  button.addEventListener("click", () => {
    if (addKnowledgeCase(question, answer)) {
      button.textContent = "Saved to knowledge";
      button.disabled = true;
    }
  });
  actions.append(button);
  content.append(actions);
}

function resizeComposer() {
  const input = document.getElementById("userInput");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function setStatus(message, state = "info") {
  const status = document.getElementById("status-box");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}
