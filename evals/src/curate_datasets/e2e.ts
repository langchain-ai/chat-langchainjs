/* eslint-disable no-process-env */

import { Client, Run } from "langsmith";
import { E2E_BLACKLISTED_RUN_IDS } from "./blacklisted_run_ids.js";

const client = new Client();

/**
 * Gets all runs with thumbs down feedback from LangSmith
 * @returns {Promise<Run[]>} - List of runs with thumbs down feedback
 */
async function loadDataset(thumbsUp: boolean): Promise<Run[]> {
  const runs: Run[] = [];
  const score = thumbsUp ? 1 : 0;
  for await (const run of client.listRuns({
    projectName: "chat-langchainjs",
    filter: `and(eq(feedback_key, "user_score"), eq(feedback_score, ${score}))`,
  })) {
    runs.push(run);
  }
  return runs;
}

/**
 * Filter duplicates, blacklisted questions from runs.
 * @param {Run[]} runs
 * @returns {Run[]} A list of runs without duplicate questions and blacklisted questions
 */
function filterDuplicatesAndBlacklistedQuestions(runs: Run[]) {
  const recordedQuestions = new Set<string>();
  const uniqueRuns = runs.filter((run) => {
    if (recordedQuestions.has(run.inputs.question)) {
      return false;
    }
    recordedQuestions.add(run.inputs.question);
    return true;
  });
  const runsNotBlacklisted = uniqueRuns.filter(
    (run) => !E2E_BLACKLISTED_RUN_IDS.includes(run.id)
  );
  console.log(
    `Found ${runsNotBlacklisted.length} unique and not blacklisted runs`
  );
  return runsNotBlacklisted;
}

/**
 * Filters out all runs with chat history, to only return
 * runs which are initial questions.
 * @param {Run[]} runs
 * @returns {Run[]} - Runs with chat history filtered out
 */
function filterWithChatHistory(runs: Run[]): Run[] {
  const runsWithoutChatHistory = runs.filter((run) => {
    if (!("chat_history" in run.inputs)) {
      return true;
    }
    if (run.inputs.chat_history.length === 0) {
      return true;
    }
    return false;
  });
  console.log(
    `Found ${runsWithoutChatHistory.length} runs without chat history`
  );
  return runsWithoutChatHistory;
}

/**
 * Given a list of runs, construct a dataset to upload to langsmith
 * @param runs
 */
async function createAndUploadDataset(runs: Run[], datasetName: string) {
  const dataset = await client.createDataset(datasetName, {
    description:
      "A question-answer pair dataset for the Chat LangChain.js project. Uses real q/a pairs from runs which received thumbs down feedback.",
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
    if (!run.outputs) {
      return;
    }
    examples.inputs.push(run.inputs);
    examples.outputs.push(run.outputs);
    examples.sourceRunIds.push(run.id);
  });
  await client.createExamples(examples);
  console.log(`Created a dataset with ${examples.inputs.length} examples.`);
}

async function curateData() {
  const datasetName = process.env.LANGSMITH_E2E_DATASET_NAME;
  if (!datasetName) {
    throw new Error("LANGSMITH_E2E_DATASET_NAME is not set");
  }

  const runs = await loadDataset(true);
  const runsWithoutHistory = filterWithChatHistory(runs);
  const filteredQuestions =
    filterDuplicatesAndBlacklistedQuestions(runsWithoutHistory);
  await createAndUploadDataset(filteredQuestions, datasetName);
}
curateData().catch(console.error);
