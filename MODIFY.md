# Modifying

The Chat LangChain repo was built to serve two use cases.
The first being question answering over the LangChain documentation.
The second is to offer a production ready chat bot which you can easily customize for your specific use case.
In this doc we'll go over each step you need to take to customize the repo for your need.

## Vector Store

One of the simplest ways to modify Chat LangChain.js and get a feel for the codebase is to modify the vector store.
All of the operations in Chat LangChain are largely based around the vector store:

- ingestion
- retrieval
- context
- etc

There are two places the vector store is used:
- **Ingestion**: The vector store is used to store the embeddings of every document used as context. Located in [`./backend/src/ingest.ts`](./backend/src/ingest.ts) you can easily modify the provider to use a different vector store.
- **Retrieval**: The vector store is used to retrieve documents based on a user's query. Located at [`/frontend/app/api/chat/stream_log/route.ts`](/frontend/app/api/chat/stream_log/route.ts) you can easily modify the provider to use a different vector store.

### Steps

For backend ingestion, locate the `ingestDocs` function.You'll want to modify the first `if` statement to instead check for any required environment variables the new provider you want to use requires. After, scroll down until you find where the `weaviateClient` and `vectorStore` variables are defined:

```typescript
const weaviateClient = (weaviate as any).client({
  scheme: "https",
  host: process.env.WEAVIATE_URL,
  apiKey: new ApiKey(process.env.WEAVIATE_API_KEY),
}) as WeaviateClient;

const vectorStore = new WeaviateStore(embeddings, {
  client: weaviateClient,
  indexName: process.env.WEAVIATE_INDEX_NAME,
  textKey: "text",
});
```

To make transitioning as easy as possible, all you should do is:

1. Delete the weaviate client instantiation.
2. Replace the vector store instantiation with the new provider's instantiation. Remember to keep the variable name (`vectorStore`) the same. Since all LangChain vector stores are built on top of the same API, no other modifications should be necessary.

Finally, perform these same steps inside the `stream_log` route, and you're done!

## Record Manager

Continuing with the database, we also employ a record manager for ingesting docs.
Currently, we use a `PostgresRecordManager`, however you may also swap that out in favor of a `MongoDocumentManager`.

```typescript
const recordManager = new PostgresRecordManager(
  `weaviate/${process.env.WEAVIATE_INDEX_NAME}`,
  {
    postgresConnectionOptions: connectionOptions,
  }
);
await recordManager.createSchema();
```

For more conceptual information on Record Managers with LangChain, see the [concepts](./CONCEPTS.md) doc.

## LLM

The LLM is used inside the `/stream_log` endpoint for generating the final answer, and performing query analysis on followup questions.

> Want to learn more about query analysis? See our comprehensive set of use case docs [here](https://js.langchain.com/docs/use_cases/query_analysis/).

Without any modification, we offer a few LLM providers out of the box:

- `gpt-3.5-turbo` by OpenAI
- `mixtral-8x7b` by Fireworks

These are all located at the top of the `stream_log` route's `POST` function. You have a few options for modifying this:

- Replace all options with a single provider
- Add more providers

First, I'll demonstrate how to replace all options with a single provider, as it's the simplest:

1. Find the LLM variable declaration at the top of the function, it looks something like this:

```typescript
let llm;
if (config.configurable.llm === "openai_gpt_3_5_turbo") {
  llm = new ChatOpenAI({
    modelName: "gpt-3.5-turbo-1106",
    temperature: 0,
  });
} else if (config.configurable.llm === "fireworks_mixtral") {
  llm = new ChatFireworks({
    modelName: "accounts/fireworks/models/mixtral-8x7b-instruct",
    temperature: 0,
  });
} else {
  throw new Error(
    "Invalid LLM option passed. Must be 'openai' or 'mixtral'. Received: " +
      config.llm,
  );
}
```

You should then remove it, and replace with your LLM class of choice, imported from LangChain. Remember to keep the variable name the same so nothing else in the endpoint breaks:

```typescript
const = new ChatYourLLM({
  modelName: "model-name",
  streaming: true,
  temperature: 0,
});
```

Adding alternatives is also quite simple. Just add another class declaration inside the `if` statement. Here's an example:

```typescript
else if (config.configurable.llm === "chat_your_llm") {
  llm = new ChatYourLLM({
    modelName: "model-name",
    streaming: true,
    temperature: 0,
  });
} else {
  throw new Error(
    "Invalid LLM option passed. Must be 'openai' or 'mixtral'. Received: " +
      config.llm,
  )
}
```

That't it!

## Embeddings

Chat LangChain uses embeddings inside the ingestion script when storing documents in the vector store.
Without modification, it defaults to use [OpenAI's embeddings model](https://js.langchain.com/docs/integrations/text_embedding/openai).

Changing this to the vector store of your choice is simple. First, find the `getEmbeddingsModel` function inside the [`./backend/src/ingest.ts`](./backend/src/ingest.ts) file. It looks something like this:

```typescript
function getEmbeddingsModel(): Embeddings {
  return new OpenAIEmbeddings();
}
```

Then, simply swap out the `OpenAIEmbeddings` class for the model of your choice!

Here's an example of what that would look like if you wanted to use Mistral's embeddings model:

```typescript
import { MistralAIEmbeddings } from "@langchain/mistralai";

function getEmbeddingsModel(): Embeddings {
  return new MistralAIEmbeddings();
}
```

## Prompts

### Answer Generation Prompt

The prompt used for answer generation is one of the most important parts of this RAG pipeline. Without a good prompt, the LLM will be unable (or severely limited) to generate good answers.

The prompt is defined in the `RESPONSE_TEMPLATE` variable.

You should modify the parts of this which are LangChain specific to instead fit your needs. If possible, and if your use case does not differ too much from the Chat LangChain use case, you should do your best to keep the same structure as the original prompt. Although there are likely some improvements to be made, we've refined this prompt over many months and lots of user feedback to what we believe to be a well formed prompt.

### Question Rephrasing Prompt

Finally, you can (but not necessary required) modify the `REPHRASE_TEMPLATE` variable to contain more domain specific content about, for example, the types of followup questions you expect to receive. Having a good rephrasing prompt will help the LLM to better understand the user's question and generate a better prompt which will have compounding effects downstream.

## Retrieval

### Ingestion Script

We'll start by modifying the ingestion script.

At a high level, the only LangChain specific part of the ingestion script are the three webpages which is scrapes for documents to add to the vector store. These links are:
- LangSmith Documentation
- LangChain.js API references
- LangChain.js Documentation

If all you would like to update is update which website(s) to scrape and ingest, you only need to modify/remove these functions:

- `loadLangSmithDocs`
- `loadAPIDocs`
- `loadLangChainDocs`

If you want to ingest another way, consult the [document loader](https://js.langchain.com/docs/modules/data_connection/document_loaders/) section of the LangChain docs.
Using any LangChain.js document loader, you'll be able to easily and efficiently fetch & ingest from a large variety of sources. Additionally, the LangChain.js document loader API will always return documents in the same format ([`DocumentInterface`](https://api.js.langchain.com/interfaces/langchain_core_documents.DocumentInterface.html)) so you do not need to modify the format before adding to your indexing API or vector store.

### Retrieval Methods

You can however, easily add or remove parts to increase/fit your needs better.
Some ideas of what can be done:

- Re-ranking document results
- Parent document retrieval (also would require modifications to the ingestion script)
- Document verification via LLM

## Frontend

The frontend doesn't have much LangChain specific code that would need modification.
The main parts are the LangChain UI branding and question suggestions.

To modify the main LangChain branding visit the [`ChatWindow.tsx`](frontend/app/components/ChatWindow.tsx) file to modify/remove.
Next, to update the question suggestions, visit the [`EmptyState.tsx`](frontend/app/components/EmptyState.tsx) file.
Finally, update the "View Source" button on the bottom of the page by going back to the [`ChatWindow.tsx`](frontend/app/components/ChatWindow.tsx) file.