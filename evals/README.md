# Chat LangChainJS Evals

This directory contains all the code around evaluating the Chat LangChainJS project.

It contains two main directories:

- **`src/curate_datasets/`**: This directory contains two files, each containing code for curating eval datasets on entire single turn conversations. The other file contains code for curatign eval datasets for the query analysis (contextual-question compression) part of the main chat chain.
- **`src/evals/`**: This directory also contains two files, each containing logic around evaluating the E2E chain, and the query analysis respectively.

## Setup

To curate datasets and run evals, you first need to create a LangSmith account. You can do so by clicking [here](https://smith.langchain.com/).

Once you have an account, set all the required environment variables. This folder comes with a [`.env.example`](.env.example) file that you can use to set the required environment variables. You can copy this file to `.env` and set the values accordingly:

```bash
# ----------------------LangSmith----------------------
LANGCHAIN_TRACING_V2=true
LANGCHAIN_ENDPOINT="https://api.smith.langchain.com"
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=
# The name of the datasets for running evals.
LANGSMITH_E2E_DATASET_NAME=""
LANGSMITH_QA_DATASET_NAME=""
# -----------------------------------------------------

OPENAI_API_KEY=
```

## Curating Datasets

Once you've set the necessary values you can start curating datasets. The code is currently setup to read from your existing runs, and curate datasets based on real world traces. However if you haven't gone to production, or can't use user data, you can modify it to synthetically generate data for your evals.

Manually looking over the examples before or after creating your dataset is a good way to filter out bad/irrelevant examples, and ensure the quality of your dataset. This is especially important if you're using real world traces, since not every user will have a good conversation. If you've put together a list of runs which you do not want in your dataset, you can add their `runId`'s to the [`E2E_BLACKLISTED_RUN_IDS` and `QA_BLACKLISTED_RUN_IDS`](./src/curate_datasets/blacklisted_run_ids.ts) arrays respectively. Then, inside the dataset curation files these `runId`'s will be filtered out.

If you can use traces from your LangSmith project, you only need to run two scripts to execute and create them:

For the end 2 end dataset:
```bash
yarn start src/curate_datasets/e2e.ts
```

For the query analysis dataset:
```bash
yarn start src/curate_datasets/query_analysis.ts
```

## Running Evals

Once your datasets have been created, you can run the evals using the examples on your production app. The first step is to start your API server, which you can do by running the following commands

Navigate into the `./frontend` directory:

```bash
cd ../frontend
```

Then start the server:

```bash
yarn start
```

If you're running evals against a locally running server, you should set the `CHAT_LANGCHAINJS_API_URL` environment variable to `http://localhost:3000` in your `.env` file.

Next, you can run the evals using the following commands:

```bash
yarn start src/evals/e2e.ts
```

```bash
yarn start src/evals/query_analysis.ts
```

These two files will run three evaluations total. The first two run inside the `e2e.ts` file. Let's break down exactly what's going on here.

### E2E Eval

This file first calls the API via the `CHAT_LANGCHAINJS_API_URL` environment URL. It calls this API route for every example you have in your dataset, and returns a data structure that contains the following:

```typescript
type Source = {
  url: string;
  title: string;
};

type APIResult = {
  finalGeneration: string;
  sources: Source[] | undefined;
};
```

These results will match whatever your current API would return given a query. Then, it passes this result to two grading functions.

The first uses the `finalGeneration` (aka the answer generated using the query from your dataset example, and retrieval against your vector store) string, and a rubric to grade it against the output you have stored in your dataset. This is graded using an LLM (defaults to OpenAI's `gpt-4-turbo-preview`, however it can easily be swapped for any model which supports the `.withStructuredOutput` method) which returns two scores: `isCorrect` and `isRelevant`. 

`isCorrect` checks that given the user query and the expected answer from your dataset, is the generated answer correct relative to the expected answer. `isRelevant` checks that the generated answer is relevant to the user query, and that the API was able to actually return an answer.

The second grading function uses the `sources` array, which is an array of sources that the API used to generate the final answer. This function is much simpler, and only verifies that sources were returned.

Once running this file, you can go into your LangSmith dataset and see the results of the eval:

**`<ADD SCREENSHOT HERE>`**

### Query Analysis Eval

This eval is slightly simpler, however it is still using an LLM to grade whether or not the query analysis part of your API chain works well. It does this by hitting the API to generate a new compressed query using the dataset we generated before. This passes an user query, and a chat history list of human/AI messages. It then returns a compressed query which is subsequently passed to a grading function.

The grading function passes four inputs to an LLM for grading:

- **Original user query**: This is the original query from the dataset.
- **Chat history**: This is the chat history which lead up to the user query, also from the dataset.
- **Expected compressed query**: This is the compressed query from the dataset.
- **Compressed query**: This is the compressed query generated by the API during the eval.

The LLM then uses a rubric to grade the new compressed query. The rubric is as follows:

- **Relevancy**: Whether or not the query is relevant to the chat history and original query.
- **Clarity**: Assess whether the generated query is clear, well-structured, and easy to understand.
- **Specific**: Evaluate if the generated query is specific enough to elicit a targeted response or if it is too broad or vague.
- **Context Aware**: Check if the generated query takes into account the context of the conversation and the user's chat history.

These four data points are all weighted evenly, and averaged to generate the final score for the query analysis eval.

Once this eval completes, you can view the results inside the LangSmith dataset for the query analysis eval:

**`<ADD SCREENSHOT HERE>`**


retrieved docs
dataset output

qa:
perform retrieval on generated query
compare retrieved docs, vs dataset docs from dataset query

compare results against other models

manually update thumbs down outputs

### Query Analysis Evaluation Process

The evaluation process for query analysis is designed to assess the effectiveness of query analysis and retrieval mechanisms. It involves several key steps, outlined below:

#### 1. Curate Dataset

The dataset for query analysis is curated in two main parts:

- **Initial Retrieval from LangSmith**: Filter conversations based on positive feedback (thumbs up) and a minimum of three messages within the conversation.
- **Data Extraction**: From the filtered conversations, extract essential data including:
  - **Chat History**: The sequence of messages leading up to the query.
  - **Original Query**: The user's query that prompted the final generation.
  - **Final Generation**: The system's response to the original query.

This extracted data is then organized into a new LangSmith dataset. The dataset structure will have the chat history and original query as inputs, and the final generation as the output.

#### 2. Run Evaluations

With the curated dataset, the evaluation process can begin:

- **Perform Query Analysis and Retrieval**: Using the inputs from the dataset (chat history and question), the system performs query analysis to generate a new query. This new query is then used to retrieve relevant documents.
- **Evaluate Retrieved Documents**: An LLM is used to assess the relevance of the retrieved documents to the original query and the synthesized answer from the dataset. This evaluation determines the effectiveness of the query analysis and retrieval process.

This structured approach ensures a comprehensive evaluation of the query analysis capabilities, focusing on the relevance and accuracy of the retrieval process in the context of the original user query and chat history.