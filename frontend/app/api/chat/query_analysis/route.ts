import { NextRequest, NextResponse } from "next/server";

import { ChatOpenAI } from "@langchain/openai";
import { ChatFireworks } from "@langchain/community/chat_models/fireworks";
import { createRephraseQuestionChain } from "./condense_question";

export const runtime = "edge";

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
