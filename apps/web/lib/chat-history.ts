// Makes a stored conversation valid to replay, whatever happened to earlier turns.
//
// History is saved step by step (user text → assistant tool calls → tool results),
// so a turn cut short (network drop, closed tab, timeout, API error) can leave:
//   - an assistant tool_use with no tool_result after it — the API then rejects
//     every later request in that chat (400) until the chat is reset;
//   - a user question with no answer, so the next question makes two user
//     messages in a row.
// It also drops redacted_thinking blocks, which DeepSeek doesn't accept.
import type Anthropic from "@anthropic-ai/sdk";

type Msg = Anthropic.MessageParam;
type Block = Anthropic.ContentBlockParam;

const INTERRUPTED = "Not run: the previous reply was interrupted before this tool finished.";

const blocks = (m: Msg): Block[] =>
  typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as Block[]);

const toolUseIds = (m: Msg) =>
  m.role === "assistant" ? blocks(m).flatMap((b) => (b.type === "tool_use" ? [b.id] : [])) : [];

const isToolResult = (b: Block): b is Anthropic.ToolResultBlockParam => b.type === "tool_result";

export function repairHistory(raw: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const m of raw) {
    let msg: Msg = { role: m.role, content: blocks(m).filter((b) => (b.type as string) !== "redacted_thinking") } as Msg;
    if (blocks(msg).length === 0) continue;
    if (out[out.length - 1]?.role === "assistant" && msg.role === "assistant") {
      // Two assistant turns in a row: keep the later one (the earlier one was superseded).
      out.pop();
    }
    const prev = out[out.length - 1];

    // Answer any tool call the previous assistant turn left open, before anything else in this message.
    const open = prev?.role === "assistant" ? toolUseIds(prev) : [];
    if (open.length) {
      const answered = new Set(msg.role === "user" ? blocks(msg).filter(isToolResult).map((b) => b.tool_use_id) : []);
      const stubs: Block[] = open
        .filter((id) => !answered.has(id))
        .map((id) => ({ type: "tool_result", tool_use_id: id, is_error: true, content: INTERRUPTED }));
      if (stubs.length) {
        if (msg.role === "user") {
          const own = blocks(msg);
          msg = { role: "user", content: [...own.filter(isToolResult), ...stubs, ...own.filter((b) => !isToolResult(b))] };
        } else {
          out.push({ role: "user", content: stubs });
        }
      }
    }

    const last = out[out.length - 1];
    if (last?.role === "user" && msg.role === "user") {
      const earlier = blocks(last);
      if (!earlier.some(isToolResult)) {
        // An unanswered question followed by a new one: the new one replaces it.
        out.pop();
      } else {
        // Tool results then a new question: one user message, results first.
        out[out.length - 1] = { role: "user", content: [...earlier, ...blocks(msg)] };
        continue;
      }
    }
    out.push(msg);
  }

  // A turn that ended right after the tool calls: answer them so the next request is valid.
  const tail = out[out.length - 1];
  const open = tail ? toolUseIds(tail) : [];
  if (open.length) {
    out.push({
      role: "user",
      content: open.map((id) => ({ type: "tool_result", tool_use_id: id, is_error: true, content: INTERRUPTED })),
    });
  }
  return out;
}
