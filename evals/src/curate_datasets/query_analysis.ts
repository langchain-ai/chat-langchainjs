/* eslint-disable no-process-env */

import { Client, Run } from "langsmith";
import { QA_BLACKLISTED_RUN_IDS } from "./blacklisted_run_ids.js";

const client = new Client();

const filterLongChatHistory = (run: Run) =>
  Boolean(run.inputs.chat_history && run.inputs.chat_history.length >= 2);

const CONDENSE_QUESTION_NAME = "CondenseQuestion";

type QueryAnalysisRuns = {
  condenseQuestionRun: Run;
  fullRun: Run;
  retrievalRun: Run;
};

/**
 * @returns {Promise<Run[]>}
 */
async function loadDataset(thumbsUp: boolean): Promise<Run[]> {
  const runs: Run[] = [];
  const score = thumbsUp ? 1 : 0;
  for await (const run of client.listRuns({
    projectName: "chat-langchainjs",
    // Only apply this filter to top level parent runs.
    traceFilter: `and(eq(feedback_key, "user_score"), eq(feedback_score, ${score}))`,
    // Inside the parent runs returned from above, only get the CondenseQuestion runs.
    filter: `and(eq(name, "${CONDENSE_QUESTION_NAME}"))`,
  })) {
    const shouldPush = filterLongChatHistory(run);
    if (shouldPush) {
      runs.push(run);
    }
  }
  return runs;
}

async function createAndUploadDataset(
  runs: QueryAnalysisRuns[],
  datasetName: string
) {
  const dataset = await client.createDataset(datasetName, {
    description:
      "Dataset of original user queries, chat history, relevant documents and the synthesized answer.",
  });

  const examples: {
    inputs: { [key: string]: string }[];
    outputs: { [key: string]: string }[];
    sourceRunIds: string[];
    datasetId: string;
  } = {
    inputs: [],
    outputs: [],
    sourceRunIds: [],
    datasetId: dataset.id,
  };

  runs.forEach((run) => {
    const { condenseQuestionRun, fullRun, retrievalRun } = run;
    if (
      !condenseQuestionRun.outputs ||
      !fullRun.outputs ||
      !retrievalRun.outputs
    ) {
      return;
    }
    examples.inputs.push({
      question: condenseQuestionRun.inputs.question,
      chat_history: condenseQuestionRun.inputs.chat_history,
      documents: retrievalRun.outputs.output,
    });
    examples.outputs.push({
      condensed_question: condenseQuestionRun.outputs.output,
      synthesized_answer: fullRun.outputs.output,
    });
    examples.sourceRunIds.push(fullRun.id);
  });
  await client.createExamples(examples);
  console.log(`Created a dataset with ${examples.inputs.length} examples.`);
}

/**
 * Filters duplicate questions and blacklisted runs.
 */
function filterBlacklistedRuns(runs: Run[]): Run[] {
  const uniqueRunQuestions = new Set<string>();
  const uniqueRuns = runs.filter((run) => {
    const originalQuestion = run.inputs.chat_history.split("ai: ")[0];
    if (uniqueRunQuestions.has(originalQuestion)) {
      return false;
    }
    uniqueRunQuestions.add(originalQuestion);
    return true;
  });
  return uniqueRuns.filter((run) => !QA_BLACKLISTED_RUN_IDS.includes(run.id));
}

async function getRunById(runId: string): Promise<Run | null> {
  let run: Run | null = null;
  for await (const r of client.listRuns({
    id: [runId],
  })) {
    run = r;
  }
  return run;
}

/**
 * Fetches parent runs until no parent exists for the given run, meaning
 * the full run has been reached. Then, it returns the original condense question
 * run, the full run, and the retrieval run.
 */
async function mapCondenseQuestionRunToParentRuns(
  run: Run
): Promise<QueryAnalysisRuns> {
  // These are hard coded since they will always be the same
  // for ChatLangChain.js runs.
  const fullRunId = run.parent_run_ids?.[0];
  const retrievalRunId = run.parent_run_ids?.[4];
  if (!fullRunId || !retrievalRunId) {
    throw new Error("Failed to find parent run ids.");
  }

  const fullRun = await getRunById(fullRunId);
  const retrievalRun = await getRunById(retrievalRunId);
  if (!fullRun || !retrievalRun) {
    throw new Error("Failed to fetch parent runs.");
  }

  return {
    condenseQuestionRun: run,
    fullRun,
    retrievalRun,
  };
}

async function curateData() {
  const datasetName = process.env.LANGSMITH_QA_DATASET_NAME;
  if (!datasetName) {
    throw new Error("LANGSMITH_QA_DATASET_NAME is not set");
  }

  const runs = await loadDataset(true);
  const filteredRuns = filterBlacklistedRuns(runs);
  const queryAnalysisRuns = await Promise.all(
    filteredRuns.map(mapCondenseQuestionRunToParentRuns)
  );
  await createAndUploadDataset(queryAnalysisRuns, datasetName);
}
curateData().catch(console.error);
