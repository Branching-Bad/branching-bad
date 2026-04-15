import type { Db } from '../db/index.js';
import type { ChatLog } from '../models.js';
import { buildMemoriesSectionForQuery } from './memoryService.js';
import { buildGlossarySection } from './glossaryService.js';
import { invokeAgentCli } from '../planner/agent.js';

/**
 * Build an enriched prompt for the chat REPL agent. The user's message is
 * kept verbatim at the top; memory + glossary context is appended at the end
 * so the model reads the user's intent first, then consults reference
 * material if needed.
 */
export function buildChatPrompt(db: Db, repoId: string, message: string): string {
  const memories = buildMemoriesSectionForQuery(db, repoId, message);
  const glossary = buildGlossarySection(db, repoId, message);
  const extras = [memories, glossary].filter(Boolean).join('');
  if (!extras) return message;
  return `${message}\n\n---\n(System context — use only if relevant; the user did not write this.)${extras}`;
}

/**
 * Compact a chat session into a ~200-word memory. Returns { title, summary }.
 * Uses the agent CLI (same pattern as createMemoryFromRun) for summarisation.
 */
export async function summariseChatSession(
  logs: ChatLog[],
  agentCommand: string,
  repoPath: string,
): Promise<{ title: string; summary: string }> {
  const transcript = buildTranscript(logs);
  if (!transcript.trim()) {
    return { title: 'Empty chat session', summary: '(no content)' };
  }

  const prompt = `You are summarising a chat session between a developer and an AI coding assistant into a compact memory for future retrieval.

Produce exactly two sections, separated by a blank line:

TITLE: <one short phrase, max 80 chars, no quotes>

SUMMARY:
<200 words maximum. Plain prose. Capture only information that will still be useful weeks later: decisions made, constraints discovered, non-obvious gotchas, concrete outcomes. Skip pleasantries, failed attempts, and anything the code or git log already records. Match the language the developer used in the chat.>

Transcript:
${transcript}`;

  let raw = '';
  try {
    const output = await invokeAgentCli(agentCommand, prompt, repoPath, null, null);
    raw = output.text;
  } catch {
    return fallbackSummary(transcript);
  }

  const parsed = parseSummaryResponse(raw);
  if (!parsed) return fallbackSummary(transcript);
  return parsed;
}

function buildTranscript(logs: ChatLog[]): string {
  const parts: string[] = [];
  for (const log of logs) {
    if (log.type === 'user_message') {
      parts.push(`USER: ${log.data}`);
    } else if (log.type === 'agent_text') {
      parts.push(`ASSISTANT: ${log.data}`);
    } else if (log.type === 'tool_use') {
      parts.push(`TOOL: ${truncate(log.data, 400)}`);
    }
    // skip thinking / tool_result / status noise
  }
  return parts.join('\n\n');
}

function parseSummaryResponse(raw: string): { title: string; summary: string } | null {
  const titleMatch = raw.match(/TITLE:\s*(.+?)(?:\n|$)/i);
  const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]+)/i);
  if (!titleMatch || !summaryMatch) return null;
  const title = titleMatch[1].trim().slice(0, 120);
  const summary = summaryMatch[1].trim();
  if (!title || !summary) return null;
  return { title, summary };
}

function fallbackSummary(transcript: string): { title: string; summary: string } {
  const firstLine = transcript.split('\n').find((l) => l.startsWith('USER:')) ?? 'Chat session';
  const title = firstLine.replace(/^USER:\s*/, '').slice(0, 80) || 'Chat session';
  const summary = truncate(transcript, 1500);
  return { title, summary };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
