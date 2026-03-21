<template>
  <div class="playground">
    <header class="header">
      <h1>JS Deobfuscator Playground</h1>
    </header>

    <div class="toolbar">
      <label><input type="checkbox" v-model="options.deobfuscate" /> Deobfuscate</label>
      <label><input type="checkbox" v-model="options.unminify" /> Unminify</label>
      <label><input type="checkbox" v-model="options.transpile" /> Transpile</label>
      <label><input type="checkbox" v-model="options.mangle" /> Mangle</label>
      <button @click="run" :disabled="processing">
        {{ processing ? 'Processing...' : 'Deobfuscate' }}
      </button>
      <span v-if="stats" class="stats">
        {{ stats.totalChanges }} changes in {{ stats.time }}ms
      </span>
      <span v-if="error" class="error">{{ error }}</span>
    </div>

    <div class="editors">
      <div class="editor-pane">
        <div class="editor-label">Input</div>
        <textarea v-model="input" class="editor" spellcheck="false" placeholder="Paste obfuscated JavaScript here..."></textarea>
      </div>
      <div class="editor-pane">
        <div class="editor-label">Output</div>
        <textarea :value="output" class="editor" readonly spellcheck="false" placeholder="Deobfuscated output will appear here..."></textarea>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from "vue";
import { transform } from "./deobfuscate.js";

const input = ref('var _0x1234 = !0;\nif (_0x1234) {\n  console.log("hello");\n}');
const output = ref("");
const processing = ref(false);
const error = ref("");
const stats = ref(null);

const options = reactive({
  deobfuscate: true,
  unminify: true,
  transpile: true,
  mangle: false,
});

async function run() {
  processing.value = true;
  error.value = "";
  stats.value = null;

  try {
    const start = performance.now();
    const result = await transform(input.value, options);
    const time = Math.round(performance.now() - start);

    output.value = result.code;
    stats.value = { totalChanges: result.totalChanges, time };
  } catch (e) {
    error.value = e.message;
  } finally {
    processing.value = false;
  }
}
</script>

<style scoped>
.playground {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.header {
  padding: 12px 20px;
  background: #1a1a2e;
  color: #e0e0e0;
}

.header h1 {
  font-size: 18px;
  font-weight: 600;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
}

.toolbar label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  cursor: pointer;
}

.toolbar button {
  padding: 6px 16px;
  background: #4361ee;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.toolbar button:hover {
  background: #3a56d4;
}

.toolbar button:disabled {
  background: #999;
  cursor: not-allowed;
}

.stats {
  font-size: 13px;
  color: #666;
}

.error {
  font-size: 13px;
  color: #e53e3e;
}

.editors {
  display: flex;
  flex: 1;
  min-height: 0;
}

.editor-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #ddd;
}

.editor-pane:last-child {
  border-right: none;
}

.editor-label {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  background: #fafafa;
  border-bottom: 1px solid #eee;
}

.editor {
  flex: 1;
  padding: 12px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 14px;
  line-height: 1.5;
  border: none;
  resize: none;
  outline: none;
  background: #1e1e1e;
  color: #d4d4d4;
}

.editor::placeholder {
  color: #666;
}
</style>
