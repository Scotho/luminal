---
name: qwen
description: Send a prompt to a local Qwen model via Ollama. Use when offloading simple tasks (boilerplate, summaries, transforms) to the local model. Triggers on "/qwen", "ask qwen", "send to qwen".
user_invocable: true
---

# Qwen — Local Model Assistant

Send prompts to a locally-running Qwen model via Ollama, using the same configuration as the admin dashboard (roles, model selection, settings from `admin/data/ollama-config.json`).

## Prerequisites

Ollama must be installed on the system. If it isn't, tell the user to install it from https://ollama.com.

## Startup Sequence

### 1. Check Ollama Status

```bash
curl -s http://localhost:5175/__admin_ollama/status
```

If admin dashboard is running, use it. Parse the JSON response for `running`, `version`, `loaded[]`, and `config`.

If admin is down, fall back to direct Ollama API:

```bash
curl -s http://localhost:11434/api/version
curl -s http://localhost:11434/api/tags
curl -s http://localhost:11434/api/ps
```

### 2. Start Ollama If Not Running

If Ollama is not running:

Via admin dashboard (preferred):
```bash
curl -s -X POST http://localhost:5175/__admin_ollama/start
```

Direct fallback:
```bash
ollama serve &
```

Wait up to 5 seconds for it to come online, polling `curl -s http://localhost:11434/` each second.

### 3. Resolve Model

Priority order:
1. If the user specified a model in the arguments (e.g., `/qwen qwen3:8b "prompt here"`), use that
2. Read config for role assignments — use the model with `primary` role
3. Fall back to the first installed model
4. If no models installed, tell the user to pull one: `ollama pull qwen3:14b`

Via admin config:
```bash
curl -s http://localhost:5175/__admin_ollama/status | python3 -c "
import sys, json
d = json.load(sys.stdin)
roles = d.get('config', {}).get('roles', {})
primary = next((m for m, r in roles.items() if r == 'primary'), None)
default = d.get('config', {}).get('defaultModel')
installed = [m['name'] for m in d.get('loaded', [])]
print(primary or default or (installed[0] if installed else ''))
"
```

Direct fallback:
```bash
curl -s http://localhost:11434/api/tags | python3 -c "
import sys, json
d = json.load(sys.stdin)
models = d.get('models', [])
print(models[0]['name'] if models else '')
"
```

### 4. Ensure Model Is Loaded

Check if the resolved model is in the loaded list (from `/api/ps`). If not, load it:

```bash
curl -s -X POST http://localhost:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"MODEL_NAME","messages":[],"keep_alive":"10m"}'
```

This pre-loads the model into VRAM so the first real prompt is fast.

## Sending the Prompt

### Via Admin Dashboard SSE (preferred)

If the admin is running, use the CC-format SSE endpoint:

```bash
curl -s -N -X POST http://localhost:5175/__admin_exec/ollama-chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"THE_USER_PROMPT","model":"MODEL_NAME"}'
```

This returns SSE events. Parse the `stdout` events for response tokens and `exit` for completion:
- `event: stdout` → `data: {"line":"token text"}`
- `event: exit` → `data: {"code":0,"total_duration":...}`

Collect all `line` values and concatenate them for the full response.

### Direct Fallback

If admin is down, call Ollama directly:

```bash
curl -s -X POST http://localhost:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"MODEL_NAME","messages":[{"role":"user","content":"THE_USER_PROMPT"}],"stream":false}'
```

The response is a single JSON object with `message.content` containing the full response.

## Output

1. Print the model name and response time
2. Print the response content
3. If the response is code, present it in a fenced code block with the appropriate language tag

Format:

```
Qwen (qwen3:14b) — 3.2s

[response content here]
```

## Usage Patterns

### Simple prompt
`/qwen What does this regex do: /^[\w.-]+@[\w.-]+\.\w{2,}$/`

### Specify model
`/qwen qwen3:8b Summarize the key exports from src/ui/render.ts`

### Code generation
`/qwen Write a TypeScript function that debounces a callback with a configurable delay`

### With file context
When you (Claude) want to use Qwen as an assistant in your workflow, you can:
1. Read a file's content
2. Construct a prompt with the content
3. Send it to Qwen via curl
4. Use Qwen's response in your work

This is useful for mechanical tasks: generating boilerplate, reformatting data, simple transforms.

## Workflow Integration

Claude can use Qwen programmatically during development sessions by calling the Ollama API directly via Bash:

```bash
RESPONSE=$(curl -s -X POST http://localhost:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3:14b","messages":[{"role":"user","content":"YOUR_PROMPT"}],"stream":false}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['content'])")
echo "$RESPONSE"
```

Good candidates for Qwen offloading:
- Generating repetitive boilerplate code
- Summarizing long files or diffs
- Simple code transforms (rename variable, convert format)
- Drafting commit messages or PR descriptions
- Quick regex/algorithm questions

Keep for Claude:
- Multi-file architectural reasoning
- Complex debugging
- Codebase-wide refactors
- Anything requiring tool use or file editing

## Notes

- Qwen runs locally — no API costs, no rate limits, no data leaves the machine
- First prompt after loading takes 2-5s (model warmup), subsequent prompts are faster
- The model stays loaded for 10 minutes by default (Ollama's keep_alive)
- If VRAM is tight, unload via: `curl -s -X POST http://localhost:5175/__admin_ollama/load -H 'Content-Type: application/json' -d '{"name":"MODEL","unload":true}'`
