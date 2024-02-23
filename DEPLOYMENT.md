# Deployment

For optional DX when deploying Chat LangChain JS, you should use Vercel for the frontend & edge API, and GitHub action for the recurring ingestion tasks.

## Prerequisites

First, fork [chat-langchainjs](https://github.com/langchain-ai/chat-langchainjs) to your GitHub account.

## Weaviate (Vector Store)

We'll use Weaviate for our vector store. You can sign up for an account [here](https://console.weaviate.cloud/).

After creating an account click "Create Cluster". Follow the steps to create a new cluster. Once finished wait for the cluster to create, this may take a few minutes.

Once your cluster has been created you should see a few sections on the page. The first is the cluster URL. Save this as your `WEAVIATE_URL` environment variable.

Next, click "API Keys" and save the API key in the environment variable `WEAVIATE_API_KEY`.

The final Weaviate environment variable is "WEAVIATE_INDEX_NAME". This is the name of the index you want to use. You can name it whatever you want, but for this example, we'll use "langchain".

After this your vector store will be setup. We can now move onto the record manager.

## Supabase (Record Manager)

Visit Supabase to create an account [here](https://supabase.com/dashboard).

Once you've created an account, click "New project" on the dashboard page.
Follow the steps, saving the database password after creating it, we'll need this later.

Once your project is setup (this also takes a few minutes), navigate to the "Settings" tab, then select "Database" under "Configuration".

Here, you should see a "Connection string" section. Copy this string, and insert your database password you saved earlier. This is your `RECORD_MANAGER_DB_URL` environment variable.

That's all you need to do for the record manager. The LangChain RecordManager API will handle creating tables for you.

## Vercel (Frontend & Edge API)

Create a Vercel account for hosting [here](https://vercel.com/signup).

Once you've created your Vercel account, navigate to [your dashboard](https://vercel.com/) and click the button "Add New..." in the top right.
This will open a dropdown. From there select "Project".

On the next screen, search for "chat-langchainjs" (if you did not modify the repo name when forking). Once shown, click "Import".

Here you should *only* modify the "Environment Variables" section. You should add the following environment variables:

> If you have not setup LangSmith, head to the [LangSmith](./LANGSMITH.md) doc for instructions.

```
LANGCHAIN_TRACING_V2=true
LANGCHAIN_ENDPOINT="https://api.smith.langchain.com"
LANGCHAIN_API_KEY=YOUR_API_KEY
LANGCHAIN_PROJECT=YOUR_PROJECT

WEAVIATE_API_KEY=YOUR_API_KEY
WEAVIATE_URL=YOUR_WEAVIATE_URL
WEAVIATE_INDEX_NAME=langchain
FORCE_UPDATE=true
RECORD_MANAGER_DB_URL=YOUR_DB_URL
OPENAI_API_KEY=YOUR_OPENAI_KEY
```

Finally, click "Deploy" and your frontend & edge API will be deployed.

## GitHub Action (Recurring Ingestion)

Now, in order for your vector store to be updated with new data, you'll need to setup a recurring ingestion task (this will also populate the vector store for the first time).

Go to your forked repository, and navigate to the "Settings" tab.

Select "Environments" from the left-hand menu, and click "New environment". Enter the name "Indexing" and click "Configure environment".

When configuring, click "Add secret" and add the following secrets:

```
OPENAI_API_KEY=
RECORD_MANAGER_DB_URL=
WEAVIATE_API_KEY=
WEAVIATE_INDEX_NAME=langchain
WEAVIATE_URL=
```

These should be the same secrets as were added to Vercel.

Next, navigate to the "Actions" tab and confirm you understand your workflows, and enable them.

Then, click on the "Update index" workflow, and click "Enable workflow". Finally, click on the "Run workflow" dropdown and click "Run workflow".

Once this has finished you can visit your production URL from Vercel, and start using the app!

# Running locally

If you wish to run this 100% locally, you'll need to update a few pieces of the code, and download extra software. Because this application was built ontop of the LangChain framework, modifying the code to run locally is simple.

## Requirements

To run locally, we'll employ [Ollama](https://ollama.com) for LLM inference and embeddings generation. For the vector store we'll use [Chroma](https://www.trychroma.com/), a free open source vector store. And finally, we'll use a simple PostgreSQL database for the record manager. Finally, for Chroma and PostgreSQL you'll need docker.

### Steps

#### Docker

To download and manage Docker containers with a GUI, you can download OrbStack [here](https://orbstack.dev/download). Once setup, we can install Chroma and PostgreSQL.

#### Chroma

To download Chroma and start a Docker container, first clone the Chroma repository:

```shell
git clone git@github.com:chroma-core/chroma.git
```

Next, navigate into the cloned repository and start the Docker container:

```shell
cd chroma
docker-compose up -d --build
```

That's it! Now, if you open OrbStack you should see a container named "Chroma" running.

#### PostgreSQL

First, pull the PostgreSQL image:

```shell
docker pull postgres
```

Then, run this command to start the image. Once finished you should see a second container running in OrbStack named "postgres"

```shell
docker run --name postgres -e POSTGRES_PASSWORD=mysecretpassword -d postgres
```

Change "mysecretpassword" to your desired password.

#### Ollama

To download Ollama, click [here](https://ollama.com/download) and select your operating system to download. Follow along with their onboarding setup.

Next, download the following models:

- [**mistral**](https://ollama.com/library/mistral): This model will be used for question rephrasing and answer generation.
- [**nomic-embed-text**](https://ollama.com/library/nomic-embed-text): We'll use this model for embeddings generation.

### Code changes

#### Ingest script

To update your ingest script to run using Chroma and your locally running PostgreSQL image, you only need to modify a few lines of code. First, navigate to the [`/backend/src/ingest.ts`](/backend/src/ingest.ts) file.

Then, find the `ingestDocs` function and update the first if statement to instead check for your PostgreSQL database credentials.

```shell
DATABASE_HOST="127.0.0.1"
DATABASE_PORT="5432"
DATABASE_USERNAME="postgres"
DATABASE_PASSWORD="mysecretpassword"
DATABASE_NAME="your-db-name" # Replace this with your database name.
```

You'll also need to create a database inside your PostgreSQL container:

```shell
docker exec -it postgres createdb -U postgres your-db-name
```

Next, find the `getEmbeddingsModel` and replace its contents with an [`OllamaEmbeddings`](https://api.js.langchain.com/classes/langchain_community_embeddings_ollama.OllamaEmbeddings.html) instance:


```typescript
import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";

function getEmbeddingsModel(): Embeddings {
  return new OllamaEmbeddings({
    model: "nomic-embed-text",
  });
}
```

For our databases, we'll want to set one more environment variable to track our collection name (similar to the index name for Weaviate):

```shell
COLLECTION_NAME="your-collection-name" # Change this to your collection name
```

Directly below where this function is invoked, you can delete the `WeaviateStore` class instantiation and replace it with a `Chroma` class instantiation:

```typescript
import { Chroma } from "@langchain/community/vectorstores/chroma";

const vectorStore = new Chroma(embeddings, {
  collectionName: process.env.COLLECTION_NAME
});
```

Finally, update the record manager namespace:

```typescript
const recordManager = new PostgresRecordManager(
  `local/${process.env.COLLECTION_NAME}`,
  {
    postgresConnectionOptions: connectionOptions,
  }
);
```

Finally, you can delete the Weaviate specific stats code at the end of the function (this is just for logging info on how many items are stored in the database).

#### API Endpoints

Next, we need to update the API endpoints to use Ollama for local LLM inference, and Chroma for document retrieval.

Navigate to the [`/api/chat/stream_log`](frontend/app/api/chat/stream_log/route.ts) endpoint.

First, find the `getRetriever` function and remove the if statement checking for Weaviate environment variables, the Chroma LangChain.js integration does not require any!

Then, replace the Weaviate specific code with Chroma and Ollama embeddings:

```typescript
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";

const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text",
});
const vectorstore = await Chroma.fromExistingCollection(
  embeddings,
  {
    collectionName: process.env.COLLECTION_NAME
  },
);
```

Finally, find the `POST` function and replace the if statements with a single llm variable instantiation:

```typescript
import { ChatOllama } from "@langchain/community/chat_models/ollama";

const llm = new ChatOllama({
  model: "mistral"
});
```

Now you're done! You can run the application 100% locally with just two commands:

1. Ingest docs:

```shell
cd ./backend && yarn build && yarn ingest
```

2. Start the Next.js application:

```shell
cd ./frontend && yarn build && yarn start
```