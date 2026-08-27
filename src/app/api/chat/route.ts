import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicClient, getAnthropicModel } from "@/lib/ai/client";
import { TOOLS, runTool } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";

const MAX_TOOL_TURNS = 6;

// Il prefisso resta stabile turno dopo turno per beneficiare del prompt
// caching lato Anthropic.
const SYSTEM_PROMPT = `Sei l'assistente personale dell'utente per la preparazione e la consultazione in vista dell'asta di fantacalcio (Serie A, modalità Classic). L'utente gestisce l'asta vera e propria altrove: questa chat serve solo per farsi consigliare o per chiedere informazioni su giocatori (quotazioni, statistiche, indice di valore, formazioni probabili, confronti).

Hai a disposizione dei tool di sola lettura sullo stesso database che alimenta l'app: usali sempre per rispondere con numeri reali, non inventare mai quotazioni, prezzi o statistiche. Se un tool restituisce "ambiguous" con dei candidati, chiedi all'utente di specificare quale intendeva invece di indovinare.

Rispondi sempre in italiano, in modo breve e diretto. Evita markdown pesante (nessuna tabella), va bene qualche elenco puntato breve se aiuta a confrontare 2-3 opzioni.`;

function encodeLine(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: object) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

export async function POST(req: Request) {
  const body = await req.json();
  const history: MessageParam[] = Array.isArray(body.messages) ? body.messages : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const client = getAnthropicClient();
        const model = getAnthropicModel();
        const system: Anthropic.TextBlockParam[] = [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ];

        const messages: MessageParam[] = [...history];

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const messageStream = client.messages.stream({
            model,
            max_tokens: 1024,
            system,
            tools: TOOLS,
            messages,
          });
          messageStream.on("text", (delta) => {
            encodeLine(controller, encoder, { type: "text", text: delta });
          });

          const final = await messageStream.finalMessage();
          messages.push({ role: "assistant", content: final.content });

          const toolUses = final.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
          );
          if (toolUses.length === 0) break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            encodeLine(controller, encoder, { type: "tool_call", name: tu.name, input: tu.input });
            const result = await runTool(tu.name, (tu.input as Record<string, unknown>) ?? {});
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
            });
          }
          messages.push({ role: "user", content: toolResults });
        }

        encodeLine(controller, encoder, { type: "done" });
      } catch (err) {
        encodeLine(controller, encoder, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
