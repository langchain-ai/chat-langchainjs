/* eslint-disable no-process-env */

import { RunnableLambda } from "@langchain/core/runnables";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { DynamicRunEvaluatorParams, runOnDataset } from "langchain/smith";
import { EvaluationResult } from "langsmith/evaluation";
import { z } from "zod";
import weaviate, { ApiKey } from "weaviate-ts-client";
import { WeaviateStore } from "@langchain/weaviate";
import { DocumentInterface } from "@langchain/core/documents";
import { getLLM } from "./get_llm.js";

type EvalChainResult = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  documents: DocumentInterface<Record<string, any>>[];
};
type EvalChainInput = {
  question: string;
  chat_history: string;
};

const documentsToString = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  documents: DocumentInterface<Record<string, any>>[]
): string =>
  documents
    .map(
      (doc, idx) =>
        `<Document id={${idx}}>\nTitle: ${doc.metadata.title}\nContent:${doc.pageContent}\n</Document>`
    )
    .join("\n\n");

/**
 * Grading function for query analysis. Given an original user query, chat history leading
 * up to that query, and the answer from that conversation turn, grade the relevance and
 * accuracy of the documents returned from a semantic search query.
 *
 * @param {DynamicRunEvaluatorParams} params The params used to grade the query analysis.
 * @returns {Promise<EvaluationResult>} The result of the grading function
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
  const { question, chat_history } = props.example.inputs;
  const { synthesized_answer } = props.example.outputs;
  const { documents } = props.run.outputs;

  const modelEnv = process.env.EVAL_GRADING_MODEL;
  if (!modelEnv) {
    throw new Error("EVAL_GRADING_MODEL is not set");
  }
  const model = getLLM(modelEnv);

  const schema = z.object({
    relevant: z
      .boolean()
      .describe(
        "Whether or not the documents are relevant to the chat history and original query."
      ),
    accuracy: z
      .enum(["full", "partial", "none"])
      .describe("The accuracy of the documents returned."),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelWithTools = (model as any).withStructuredOutput(schema, {
    name: "gradingFunction",
  });
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an expert software engineer, tasked with grading documents returned from a semantic search query, against a user's original query and chat history.
You should think through each part of the grading rubric carefully, and provide an answer you're confident in.

You're provided with the following context:
- Original Query: The user's original, unmodified question.
- Chat History: The user's chat history leading up to the question.
- Answer: A final answer to the question the user asked.

The grading rubric is as follows:
- Relevant: whether or not the documents are relevant and helpful to the user's original query/chat history
- Accuracy: whether or not the user could accurately answer their question in full, using ONLY the documents returned.

The following context is provided:

<Original Query>
{original_query}
</Original Query>

<Chat History>
{chat_history}
</Chat History>

<Answer>
{synthesized_answer}
</Answer>`,
    ],
    [
      "human",
      `Here are the documents returned from the semantic search query:
<Documents>
{documents}
</Documents>`,
    ],
  ]);

  const chain = prompt.pipe<z.infer<typeof schema>>(modelWithTools);
  const { relevant, accuracy } = await chain.invoke({
    original_query: question,
    chat_history,
    synthesized_answer,
    documents: documentsToString(documents),
  });

  // Convert all booleans to scores
  const relevantScore = relevant ? 1 : 0;
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
  // Calculate the score
  const score = (relevantScore + accuracyScore) / 2;

  return {
    key: "query_analysis",
    score,
    value: {
      relevant,
      accuracy,
    },
  };
}

/**
 * Generate a condensed query using the input question and chat history.
 *
 * @param {EvalChainInput} input The question and chat history to generate a condensed query for.
 * @returns {Promise<{ rephrasedQuery: string; }>} The rephrased query.
 */
async function generateCondensedQuery(input: EvalChainInput) {
  const baseApiUrl = process.env.BASE_API_URL;
  if (!baseApiUrl) {
    throw new Error("BASE_API_URL is not set");
  }
  const queryAnalysisApiUrl = new URL(baseApiUrl);
  queryAnalysisApiUrl.pathname = "/api/chat/query_analysis";
  const queryAnalysisUrl = queryAnalysisApiUrl.toString();

  const llm = process.env.API_EVAL_MODEL;
  if (!llm) {
    throw new Error("API_EVAL_MODEL is not set");
  }

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

/**
 * Function which condenses a question, and performs a semantic search
 * using the condensed question to retrieve relevant documents.
 *
 * @param {RetrieveDocumentsInput} input The input to the eval chain. Consists of a question and chat history.
 * @returns {Promise<EvalChainResult>} The result of the eval chain. Consists of an array of documents returned from the retriever.
 */
async function retrieveDocuments(
  input: EvalChainInput
): Promise<EvalChainResult> {
  const [{ rephrasedQuery }, retriever] = await Promise.all([
    generateCondensedQuery(input),
    getRetriever(),
  ]);
  const documents = await retriever.invoke(rephrasedQuery);
  return {
    documents,
  };
}

async function getRetriever() {
  if (
    !process.env.WEAVIATE_INDEX_NAME ||
    !process.env.WEAVIATE_API_KEY ||
    !process.env.WEAVIATE_URL
  ) {
    throw new Error(
      "WEAVIATE_INDEX_NAME, WEAVIATE_API_KEY and WEAVIATE_URL environment variables must be set"
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (weaviate as any).client({
    scheme: "https",
    host: process.env.WEAVIATE_URL,
    apiKey: new ApiKey(process.env.WEAVIATE_API_KEY),
  });
  const vectorstore = await WeaviateStore.fromExistingIndex(
    new OpenAIEmbeddings({}),
    {
      client,
      indexName: process.env.WEAVIATE_INDEX_NAME,
      textKey: "text",
      metadataKeys: ["source", "title"],
    }
  );
  return vectorstore.asRetriever({ k: 6 });
}

export async function queryAnalysisEval() {
  const datasetName = process.env.LANGSMITH_QA_DATASET_NAME;
  if (!datasetName) {
    throw new Error("LANGSMITH_QA_DATASET_NAME is not set");
  }

  const chain = new RunnableLambda({
    func: retrieveDocuments,
  });
  const projectName = `query_analysis_eval_${new Date().toISOString()}`;
  const projectMetadata = {
    judge_llm: process.env.EVAL_GRADING_MODEL,
    condense_query_llm: process.env.API_EVAL_MODEL,
  };
  const evalResult = await runOnDataset(chain, datasetName, {
    projectName,
    projectMetadata,
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
