export function askAnythingPrompt(utterance: string): string {
  return `The banker just asked: "${utterance}"

Decide which MCP servers are needed. Call them in parallel. Synthesize the answer in ≤ 120 words. If the answer implies an action, propose a DRAFT action the banker can approve with one click.

Be direct. Bankers read this between meetings.`;
}
