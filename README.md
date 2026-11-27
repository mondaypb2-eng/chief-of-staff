# Personal Chief of Staff Agent (via MCP)

Open: http://localhost/chief-of-staff/ (needs XAMPP Apache + MySQL running; this machine's MySQL is on port **3307**)

## Architecture
```
Browser (PHP + Bootstrap 5, XAMPP)
   └─ api.php ──proc_open──> node mcp/agent/run.js          (agent loop: Claude via @anthropic-ai/sdk tool runner)
                                ├─ stdio ─> task-calendar-mcp       tasks · events · free slots · daily plan · clarifications
                                ├─ stdio ─> knowledge-notes-mcp     notes
                                ├─ stdio ─> personal-crm-mcp        people · interactions · birthdays
                                └─ stdio ─> shopping-inventory-mcp  shopping list · inventory
                                                 └─ MySQL (XAMPP)  database chief_of_staff
```
- **Capture & Organize:** prompts `0_role` + `1_split_dedupe`
- **Sync & Brief:** prompts `0_role` + `2_context_linker` + `3_timebox_nudge`
- Duplicate checks and plan validation (overlaps, working hours, travel time) live in the MCP servers, so they don't rely on the model alone.

## Two AI engines (choose on the Settings page)
| | Local LLM (Ollama) — default | Claude API |
|---|---|---|
| Cost | Free, data never leaves the machine | Pay per use |
| Approach | **Workflow:** the model handles language only (prompts/local), and code handles the rest | **Agent:** Claude picks which MCP tools to call itself (prompts 0–3) |
| Models | `qwen3:4b` (language) + `bge-m3` (semantic search) | `claude-opus-5-5` |

Conditions that make the local model accurate and fast on a 4GB GPU:
1. **The model answers in JSON that follows a schema** (`format`), with temperature 0 and think mode off, and gets one retry with the error if the answer is malformed.
2. **Code does what a small model gets wrong:** converting Thai time words (`lib/thai-time.js`, where the last time said wins), duplicate checks/merging through MCP, checking whether a person's name is ambiguous, time-boxing work into slots, and fixing mislabelled item types.
3. **Context linking:** bge-m3 shortlists candidates first (threshold 0.52), then the model chooses only from that list. Any id outside the list is dropped.
4. **Validation at the MCP server:** a plan that overlaps or falls outside working hours is rejected.

## Commands (run in `mcp/`)
| Command | What it does |
|---|---|
| `node setup.js --reset --seed` | Recreate the DB with demo data |
| `node test/smoke.js` | Test all 4 MCP servers directly (no AI, 20 checks) |
| `node eval/run-eval.js [case]` | Run the Eval with Claude (needs an API key), using DB `chief_of_staff_eval` |

## Using the MCP servers from Claude Code / Claude Desktop
The `.mcp.json` file in this folder is a project-scoped config: open Claude Code in this folder and the servers load automatically.
Or add them one at a time: `claude mcp add task-calendar -- C:\nvm4w\nodejs\node.exe C:\xampp\htdocs\chief-of-staff\mcp\servers\task-calendar.js`
