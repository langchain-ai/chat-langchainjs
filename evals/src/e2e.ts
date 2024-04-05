/* eslint-disable no-process-env */

import { RemoteRunnable } from "@langchain/core/runnables/remote";
import { applyPatch } from "@langchain/core/utils/json_patch";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Runnable, RunnableLambda } from "@langchain/core/runnables";
import { BaseMessage } from "@langchain/core/messages";
import { runOnDataset } from "langchain/smith";
import {
  GradingFunctionParams,
  GradingFunctionResult,
  StringEvaluator,
} from "langsmith/evaluation";
import { z } from "zod";

type Source = {
  url: string;
  title: string;
};

type APIResult = {
  finalOutputString: string;
};

/**
 * Grade the results of the Chat LangChain API against expected
 * results from the dataset.
 * @param {GradingFunctionParams} params The input, prediction, and answer to grade
 * @returns {Promise<GradingFunctionResult>} The result of the grading function
 */
async function gradingFunction(
  params: GradingFunctionParams
): Promise<GradingFunctionResult> {
  const model = new ChatOpenAI({
    modelName: "gpt-4-turbo",
    temperature: 0,
  });
  const schema = z.object({
    hasCitations: z
      .boolean()
      .describe("Whether or not the answer contains citations."),
    answersQuestion: z
      .boolean()
      .describe(
        "Whether or not an answer is provided. Should be false if the answer is off topic."
      ),
    isCorrect: z
      .boolean()
      .describe(
        "Whether or not the answer is correct, in respect to the expected answer."
      ),
  });
  const modelWithTools = model.withStructuredOutput(schema, {
    name: "gradingFunction",
  });
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an expert software engineer, tasked with grading the answer to a question.
You should think through each part of the grading rubric carefully, and provide an answer you're confident in.
Your rubric is as follows:
- hasCitations: Does the answer contain citations? Additionally, do the citation title's and URLs appear to be correct?
- answersQuestion: Does the answer actually answer the question?
- isCorrect: Is the answer correct? Use the expected answer as context to answer this.

<Question>
{question}
</Question>

<Expected Answer>
{expected_answer}
</Expected Answer>`,
    ],
    [
      "human",
      `Here is the answer to the question:

<Human Answer>
{human_answer}
</Human Answer>`,
    ],
  ]);

  const chain = prompt.pipe(modelWithTools);
  const { hasCitations, answersQuestion, isCorrect } = await chain.invoke({
    question: params.input,
    expected_answer: params.answer ?? "",
    human_answer: params.prediction,
  });
  // Assign weights to the grades and calculate a score.
  let score = 0;
  if (hasCitations && answersQuestion && isCorrect) {
    // If all of the above are true, the score is 1 (true).
    score = 1;
  }
  return {
    key: "e2e",
    score,
    value: {
      has_citations: hasCitations,
      answers_question: answersQuestion,
      is_correct: isCorrect,
    },
  };
}

/**
 * Run the evaluator on a chain (the Chat LangChain API), and automatically
 * have the results saved to the dataset.
 * @param {Runnable} chain A chain to run the evaluator on
 * @param {string} datasetName The name of the dataset to save the results to
 * @returns {Promise<EvalResults>} The result of the evaluation
 */
async function runEvaluator(chain: Runnable, datasetName: string) {
  const evaluator = new StringEvaluator({
    gradingFunction,
    evaluationName: "Evaluate Generated Answers (E2E)",
    inputKey: "question", // The key of the question from the dataset
    answerKey: "output", // The key of the expected answer from the dataset
    predictionKey: "finalOutputString", // The key of the generated answer from the ChatLangChain API
  });

  return runOnDataset(chain, datasetName, {
    evaluationConfig: {
      customEvaluators: [evaluator],
    },
  });
}

/**
 * Given an example as input, make a streamLog request to
 * the API, and process the output.
 * @param {{ question: string, chat_history: Array<BaseMessage> }} input
 * @returns {Promise<APIResult>} The final output string from the API
 */
async function processExample(input: {
  question: string;
  chat_history: Array<BaseMessage>;
}): Promise<APIResult> {
  const baseApiUrl = process.env.CHAT_LANGCHAINJS_API_URL;
  if (!baseApiUrl) {
    throw new Error("CHAT_LANGCHAINJS_API_URL is not set");
  }
  const streamLogApiUrl = new URL(baseApiUrl);
  streamLogApiUrl.pathname = "/api";
  const streamLogUrl = streamLogApiUrl.toString();

  const llm = "openai_gpt_3_5_turbo";

  const sourceStepName = "FindDocs";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let streamedResponse: Record<string, any> = {};
  const remoteChain = new RemoteRunnable({
    url: `${streamLogUrl}/chat`,
    options: {
      timeout: 60000,
    },
  });
  const streamLog = remoteChain.streamLog(
    {
      question: input.question,
      chat_history: input.chat_history,
    },
    {
      configurable: {
        llm,
      },
      tags: [`model:${llm}`],
    },
    {
      includeNames: [sourceStepName],
    }
  );

  let accumulatedMessage = "";
  let sources: Source[] | undefined;

  // Handle the stream
  for await (const chunk of streamLog) {
    streamedResponse = applyPatch(streamedResponse, chunk.ops).newDocument;
    if (
      Array.isArray(
        streamedResponse?.logs?.[sourceStepName]?.final_output?.output
      )
    ) {
      sources = streamedResponse.logs[
        sourceStepName
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ].final_output.output.map((doc: Record<string, any>) => ({
        url: doc.metadata.source,
        title: doc.metadata.title,
      }));
    }
    if (Array.isArray(streamedResponse?.streamed_output)) {
      accumulatedMessage = streamedResponse.streamed_output.join("");
    }
  }

  const finalOutputString = `Final output: ${accumulatedMessage}\n\nSources: ${sources
    ?.map((s) => `${s.title}: ${s.url}`)
    .join("\n")}`;
  return {
    finalOutputString,
  };
}

/**
 * Run an end to end evaluation on the Chat LangChain.js API.
 * Results are automatically uploaded to the dataset in LangSmith.
 */
export async function e2eEval() {
  const datasetName = process.env.LANGSMITH_E2E_DATASET_NAME;
  if (!datasetName) {
    throw new Error("LANGSMITH_E2E_DATASET_NAME is not set");
  }

  const chain = new RunnableLambda({
    func: processExample,
  });
  const evalResult = await runEvaluator(chain, datasetName);
  console.log(`Eval successfully completed!\nEval Result: ${evalResult}`);
}
