/* eslint-disable no-process-env */

import { Client, Run } from "langsmith";
import { QA_BLACKLISTED_RUN_IDS } from "./blacklisted_run_ids.js";

const client = new Client();

const filterLongChatHistory = (run: Run) =>
  Boolean(run.inputs.chat_history && run.inputs.chat_history.length >= 2);

const CONDENSE_QUESTION_NAME = "CondenseQuestion";

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

async function createAndUploadDataset(runs: Run[]) {
  const dataset = await client.createDataset("chat-langchainjs-qa", {
    description:
      "Dataset of original user queries, their chat history and the rephrased question.",
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

function filterBlacklistedRuns(runs: Run[]): Run[] {
  return runs.filter((run) => !QA_BLACKLISTED_RUN_IDS.includes(run.id));
}

async function curateData() {
  const datasetName = process.env.LANGSMITH_QA_DATASET_NAME;
  if (!datasetName) {
    throw new Error("LANGSMITH_QA_DATASET_NAME is not set");
  }

  const runs = await loadDataset(true);
  const filteredRuns = filterBlacklistedRuns(runs);
  await createAndUploadDataset(filteredRuns);
}
curateData().catch(console.error);
