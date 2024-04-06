/* eslint-disable no-process-env */

import { RemoteRunnable } from "@langchain/core/runnables/remote";
import { applyPatch } from "@langchain/core/utils/json_patch";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda } from "@langchain/core/runnables";
import { BaseMessage } from "@langchain/core/messages";
import { DynamicRunEvaluatorParams, runOnDataset } from "langchain/smith";
import { EvaluationResult } from "langsmith/evaluation";
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
  props: DynamicRunEvaluatorParams
): Promise<EvaluationResult> {
  if (!props.run.outputs) {
    throw new Error("Failed to get outputs from run");
  }
  if (!props.example?.outputs) {
    throw new Error("No example outputs found");
  }
  const { question } = props.run.inputs;
  const { output: expectedOutput } = props.example.outputs;
  const { finalOutputString: generatedAnswer } = props.run.outputs;
  const model = new ChatOpenAI({
    modelName: "gpt-4-turbo-preview",
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
    question,
    expected_answer: expectedOutput,
    human_answer: generatedAnswer,
  });

  // Assign weights to the grades and calculate a score.
  const hasCitationsWeight = 0.2;
  const answersQuestionWeight = 0.4;
  const isCorrectWeight = 0.4;
  const hasCitationsValue = hasCitations ? 1 : 0;
  const answersQuestionValue = answersQuestion ? 1 : 0;
  const isCorrectValue = isCorrect ? 1 : 0;
  const score =
    hasCitationsValue * hasCitationsWeight +
    answersQuestionValue * answersQuestionWeight +
    isCorrectValue * isCorrectWeight;

  return {
    key: "End 2 End",
    score,
    value: {
      has_citations: hasCitations,
      answers_question: answersQuestion,
      is_correct: isCorrect,
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
  const evalResult = await runOnDataset(chain, datasetName, {
    evaluationConfig: {
      customEvaluators: [gradingFunction],
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
