import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

export function getLLM(llm: string) {
  let model;
  switch (llm) {
    case "gpt_4_turbo_preview":
      model = new ChatOpenAI({
        modelName: "gpt-4-turbo-preview",
        temperature: 0,
      });
      break;
    case "anthropic_opus":
      model = new ChatAnthropic({
        model: "claude-3-opus-20240229",
        temperature: 0,
      });
      break;
    default:
      throw new Error(`Invalid model environment: ${llm}`);
  }

  if (typeof model.withStructuredOutput !== "function") {
    throw new Error(`Model ${llm} must support "withStructuredOutput".`);
  }

  return model;
}
