import weaviate, { ApiKey, WeaviateClient } from "weaviate-ts-client";
import { DocumentInterface } from "@langchain/core/documents";
import { RecursiveUrlLoader } from "langchain/document_loaders/web/recursive_url";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Embeddings } from "@langchain/core/embeddings";
import { WeaviateStore } from "@langchain/weaviate";
import { WEAVIATE_DOCS_INDEX_NAME } from "./constants.js";
import { PostgresRecordManager } from "@langchain/community/indexes/postgres";
import { index } from "./_index.js";
import { SitemapLoader } from "langchain/document_loaders/web/sitemap";

/**
 * Load all of the LangSmith documentation via the
 * `RecursiveUrlLoader` and return the documents.
 * @returns {Promise<Array<DocumentInterface>>}
 */
async function loadLangSmithDocs(): Promise<Array<DocumentInterface>> {
  const loader = new RecursiveUrlLoader("https://docs.smith.langchain.com/", {
    maxDepth: 8,
    timeout: 600,
  });
  return loader.load();
}

/**
 * Load all of the LangChain.js API references via
 * the `RecursiveUrlLoader` and return the documents.
 * @returns {Promise<Array<DocumentInterface>>}
 */
async function loadAPIDocs(): Promise<Array<DocumentInterface>> {
  const loader = new RecursiveUrlLoader("https://api.js.langchain.com/index.html/", {
    maxDepth: 8,
    timeout: 600,
  });
  return loader.load();
}

/**
 * Load all of the LangChain docs via the sitemap.
 * @returns {Promise<Array<DocumentInterface>>}
 */
async function loadLangChainDocs(): Promise<Array<DocumentInterface>> {
  const loader = new SitemapLoader("https://js.langchain.com/", {
    filterUrls: ["https://js.langchain.com/"]
  });
  return loader.load();
}

function getEmbeddingsModel(): Embeddings {
  return new OpenAIEmbeddings()
}

const POSTGRES_CONNECTION_OPTIONS = {
  postgresConnectionOptions: {
    type: "postgres",
    host: "127.0.0.1",
    port: 5432,
    user: "myuser",
    password: "ChangeMe",
    database: "api",
  },
}

async function ingestDocs() {
  if (!process.env.WEAVIATE_API_KEY || !process.env.WEAVIATE_HOST) {
    throw new Error("WEAVIATE_API_KEY and WEAVIATE_HOST must be set in the environment");
  }

  const smithDocs = await loadLangSmithDocs();
  console.debug(`Loaded ${smithDocs.length} docs from LangSmith`)
  const apiDocs = await loadAPIDocs();
  console.debug(`Loaded ${apiDocs.length} docs from API`)
  const langchainDocs = await loadLangChainDocs();
  console.debug(`Loaded ${langchainDocs.length} docs from documentation`);

  const textSplitter = new RecursiveCharacterTextSplitter({ chunkOverlap: 200, chunkSize: 4000 });
  const docsTransformed = await textSplitter.splitDocuments([
    ...smithDocs,
    ...apiDocs,
    ...langchainDocs,
  ]);

  // We try to return 'source' and 'title' metadata when querying vector store and
  // Weaviate will error at query time if one of the attributes is missing from a
  // retrieved document.

  for (const doc of docsTransformed) {
    if (!doc.metadata.source) {
      doc.metadata.source = "";
    }
    if (doc.metadata.title) {
      doc.metadata.title = "";
    }
  }
  
  const weaviateClient = (weaviate as any).client({
    scheme: "https",
    host: process.env.WEAVIATE_HOST,
    apiKey: new ApiKey(process.env.WEAVIATE_API_KEY)
  }) as WeaviateClient

  const embeddings = getEmbeddingsModel();
  const vectorStore = new WeaviateStore(embeddings, {
    client: weaviateClient,
    indexName: WEAVIATE_DOCS_INDEX_NAME,
    textKey: "text",
  });
  const recordManager = new PostgresRecordManager(`weaviate/${WEAVIATE_DOCS_INDEX_NAME}`, POSTGRES_CONNECTION_OPTIONS);
  await recordManager.createSchema();

  const indexingStats = await index({
    docsSource: docsTransformed,
    recordManager,
    vectorStore,
    cleanup: "full",
    sourceIdKey: "source",
    forceUpdate: process.env.FORCE_UPDATE === "true",
  })

  // load index
  // query weaviateClient for num of vectors and log!
  console.log({
    indexingStats,
  }, "Indexing stats");
  const numVecs = await weaviateClient.misc.metaGetter().do();
  console.log(`Bruh what is dis?:\n\n${JSON.stringify(numVecs, null, 2)}`);
}

ingestDocs()
  .catch((e) => {
    console.error("Failed to ingest docs");
    console.error(e);
    process.exit(1);
  });