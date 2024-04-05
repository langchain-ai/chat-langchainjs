import { NextRequest, NextResponse } from "next/server";

import { Runnable, RunnableSequence } from "@langchain/core/runnables";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { ChatFireworks } from "@langchain/community/chat_models/fireworks";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";

export const runtime = "edge";

const REPHRASE_TEMPLATE = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.

Chat History:
{chat_history}
Follow Up Input: {question}
Standalone Question:`;

export function createRephraseQuestionChain(
  llm: BaseChatModel,
): Runnable<{ chat_history: string; question: string }, string> {
  const CONDENSE_QUESTION_PROMPT =
    PromptTemplate.fromTemplate(REPHRASE_TEMPLATE);
  const condenseQuestionChain = RunnableSequence.from([
    CONDENSE_QUESTION_PROMPT,
    llm,
    new StringOutputParser(),
  ]).withConfig({
    runName: "CondenseQuestion",
  });

  return condenseQuestionChain;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = body.input;
    const config = body.config;

    let llm;
    if (config.configurable.llm === "openai_gpt_3_5_turbo") {
      llm = new ChatOpenAI({
        modelName: "gpt-3.5-turbo-1106",
        temperature: 0,
      });
    } else if (config.configurable.llm === "fireworks_mixtral") {
      llm = new ChatFireworks({
        modelName: "accounts/fireworks/models/mixtral-8x7b-instruct",
        temperature: 0,
      });
    } else {
      throw new Error(
        "Invalid LLM option passed. Must be 'openai' or 'mixtral'. Received: " +
          config.configurable.llm,
      );
    }

    const rephraseQuestionChain = createRephraseQuestionChain(llm);

    const rephrasedQuery = await rephraseQuestionChain.invoke({
      question: input.question,
      chat_history: input.chat_history,
    });

    return new Response(rephrasedQuery);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
