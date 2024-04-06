/* eslint-disable no-process-env */

import { RunnableLambda } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { DynamicRunEvaluatorParams, runOnDataset } from "langchain/smith";
import { EvaluationResult } from "langsmith/evaluation";
import { z } from "zod";

/**
 * Grading function for query analysis. Given an original query, and a predicted
 * query along with chat history, grade the predicted query.
 * @param {GradingFunctionParams} params The params used to grade the query analysis.
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
  const { question, chat_history } = props.run.inputs;
  const { output: expectedOutput } = props.example.outputs;
  const { rephrasedQuery } = props.run.outputs;
  const model = new ChatOpenAI({
    modelName: "gpt-4-turbo-preview",
    temperature: 0,
  });
  const schema = z.object({
    relevant: z
      .boolean()
      .describe(
        "Whether or not the query is relevant to the chat history and original query."
      ),
    clear: z
      .boolean()
      .describe(
        "Assess whether the generated query is clear, well-structured, and easy to understand."
      ),
    specific: z
      .boolean()
      .describe(
        "Evaluate if the generated query is specific enough to elicit a targeted response or if it is too broad or vague."
      ),
    context_aware: z
      .boolean()
      .describe(
        "Check if the generated query takes into account the context of the conversation and the user's chat history."
      ),
  });

  const modelWithTools = model.withStructuredOutput(schema, {
    name: "gradingFunction",
  });
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an expert software engineer, tasked with grading a generated query, based on the users original query and chat history.
You should think through each part of the grading rubric carefully, and provide an answer you're confident in.
Your rubric is as follows:
- relevant: Whether or not the query is relevant to the chat history and original query.
- clear: Assess whether the generated query is clear, well-structured, and easy to understand.
- specific: Evaluate if the generated query is specific enough to elicit a targeted response or if it is too broad or vague.
- context aware: Check if the generated query takes into account the context of the conversation and the user's chat history.

<Original Query>
{original_query}
</Original Query>

<Chat History>
{chat_history}
</Chat History>

Here is an example of a high scoring generated query:
<High Scoring Query>
{high_scoring_query}
</High Scoring Query>`,
    ],
    [
      "human",
      `Here is the generated query:

<Human Answer>
{generated_question}
</Human Answer>`,
    ],
  ]);

  const chain = prompt.pipe(modelWithTools);
  const { relevant, clear, specific, context_aware } = await chain.invoke({
    original_query: question,
    chat_history,
    high_scoring_query: expectedOutput,
    generated_question: rephrasedQuery,
  });
  // Convert all booleans to scores
  const relevantScore = relevant ? 1 : 0;
  const clearScore = clear ? 1 : 0;
  const specificScore = specific ? 1 : 0;
  const contextAwareScore = context_aware ? 1 : 0;
  // Calculate the score
  const score =
    (relevantScore + clearScore + specificScore + contextAwareScore) / 4;
  return {
    key: "query_analysis",
    score,
    value: {
      relevant,
      clear,
      specific,
      context_aware,
    },
  };
}

/**
 * Define a func which will call the QA function to generate yo!
 */
async function generateQueries(input: {
  question: string;
  chat_history: string;
}) {
  const baseApiUrl = process.env.CHAT_LANGCHAINJS_API_URL;
  if (!baseApiUrl) {
    throw new Error("CHAT_LANGCHAINJS_API_URL is not set");
  }
  const queryAnalysisApiUrl = new URL(baseApiUrl);
  queryAnalysisApiUrl.pathname = "/api/chat/query_analysis";
  const queryAnalysisUrl = queryAnalysisApiUrl.toString();

  const llm = "openai_gpt_3_5_turbo";

  const res = await fetch(queryAnalysisUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input,
      config: {
        configurable: {
          llm,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to generate queries: ${res.statusText}`);
  }
  const rephrasedQuery = await res.text();
  return {
    rephrasedQuery,
  };
}

export async function queryAnalysisEval() {
  const datasetName = process.env.LANGSMITH_QA_DATASET_NAME;
  if (!datasetName) {
    throw new Error("LANGSMITH_QA_DATASET_NAME is not set");
  }

  const chain = new RunnableLambda({
    func: generateQueries,
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
queryAnalysisEval().catch(console.error);
