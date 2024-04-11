import { Runnable, RunnableSequence } from "@langchain/core/runnables";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";

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
