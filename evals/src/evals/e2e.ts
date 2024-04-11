/* eslint-disable no-process-env */

import { RemoteRunnable } from "@langchain/core/runnables/remote";
import { applyPatch } from "@langchain/core/utils/json_patch";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda } from "@langchain/core/runnables";
import { BaseMessage } from "@langchain/core/messages";
import { DynamicRunEvaluatorParams, runOnDataset } from "langchain/smith";
import { EvaluationResult } from "langsmith/evaluation";
import { z } from "zod";
import { getLLM } from "./get_llm.js";

type Source = {
  url: string;
  title: string;
};

type APIResult = {
  finalGeneration: string;
  sources: Source[] | undefined;
};

/**
 * Grade the results of the Chat LangChain API against expected
 * results from the dataset.
 * @param {GradingFunctionParams} params The input, prediction, and answer to grade
 * @returns {Promise<GradingFunctionResult>} The result of the grading function
 */
async function gradeFinalAnswer(
  props: DynamicRunEvaluatorParams
): Promise<EvaluationResult> {
  if (!props.run.outputs) {
    throw new Error("Failed to get outputs from run");
  }
  if (!props.example?.outputs) {
    throw new Error("No example outputs found");
  }
  const { question } = props.run.inputs;
  const { finalGeneration: generatedAnswer } = props.run.outputs as APIResult;
  const { output: expectedOutput } = props.example.outputs;

  const modelEnv = process.env.EVAL_GRADING_MODEL;
  if (!modelEnv) {
    throw new Error("EVAL_GRADING_MODEL is not set");
  }
  const model = getLLM(modelEnv);

  const schema = z.object({
    answersQuestion: z
      .boolean()
      .describe(
        "Whether or not an answer is provided. Should be false if the answer is off topic."
      ),
    accuracy: z
      .enum(["full", "partial", "none"])
      .describe("How accurate the answer is compared to the expected answer."),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelWithTools = (model as any).withStructuredOutput(schema, {
    name: "gradingFunction",
  });
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an expert software engineer, tasked with grading the answer to a question.
You should think through each part of the grading rubric carefully, and provide an answer you're confident in.
Your rubric is as follows:
- answersQuestion: Whether or not the answer is provided. Should be false if the answer is off topic.
- accuracy: How accurate the answer is compared to the expected answer.

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

  const chain = prompt.pipe<z.infer<typeof schema>>(modelWithTools);
  const { answersQuestion, accuracy } = await chain.invoke({
    question,
    expected_answer: expectedOutput,
    human_answer: generatedAnswer,
  });

  const answersQuestionValue = answersQuestion ? 1 : 0;
  let accuracyScore = 0;
  switch (accuracy) {
    case "full":
      accuracyScore = 1;
      break;
    case "partial":
      accuracyScore = 0.5;
      break;
    case "none":
      accuracyScore = 0;
      break;
    default:
      throw new Error(`Unexpected accuracy value: ${accuracy}`);
  }
  const score = (answersQuestionValue + accuracyScore) / 2;

  return {
    key: "End 2 End",
    score,
    value: {
      answers_question: answersQuestion,
      accuracy,
    },
  };
}

function gradeReturnedSources(
  props: DynamicRunEvaluatorParams
): EvaluationResult {
  if (!props.run.outputs) {
    throw new Error("Failed to get outputs from run");
  }
  const { sources } = props.run.outputs as APIResult;
  const score = sources && sources.length > 0 ? 1 : 0;
  return {
    key: "Has Sources",
    score,
    value: {
      source_count: sources?.length,
    },
  };
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
  const baseApiUrl = process.env.BASE_API_URL;
  if (!baseApiUrl) {
    throw new Error("BASE_API_URL is not set");
  }
  const streamLogApiUrl = new URL(baseApiUrl);
  streamLogApiUrl.pathname = "/api";
  const streamLogUrl = streamLogApiUrl.toString();

  const llm = process.env.API_EVAL_MODEL;
  if (!llm) {
    throw new Error("API_EVAL_MODEL is not set");
  }

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

  return {
    finalGeneration: accumulatedMessage,
    sources,
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
  const projectName = `e2e_eval_${new Date().toISOString()}`;
  const projectMetadata = {
    judge_llm: process.env.EVAL_GRADING_MODEL,
    condense_query_llm: process.env.API_EVAL_MODEL,
  };
  const evalResult = await runOnDataset(chain, datasetName, {
    projectName,
    projectMetadata,
    evaluationConfig: {
      customEvaluators: [gradeFinalAnswer, gradeReturnedSources],
    },
  });
  console.log(
    `Eval successfully completed!\nEval Result: ${JSON.stringify(
      evalResult,
      null,
      2
    )}`
  );
}
e2eEval().catch(console.error);
