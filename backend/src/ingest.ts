/* eslint-disable no-process-env */
import weaviate, { ApiKey, WeaviateClient } from "weaviate-ts-client";
import { DocumentInterface } from "@langchain/core/documents";
import { RecursiveUrlLoader } from "langchain/document_loaders/web/recursive_url";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Embeddings } from "@langchain/core/embeddings";
import { WeaviateStore } from "@langchain/weaviate";
import { PostgresRecordManager } from "@langchain/community/indexes/postgres";
import { SitemapLoader } from "langchain/document_loaders/web/sitemap";
import { index } from "./_index.js";

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
  const loader = new RecursiveUrlLoader(
    "https://api.js.langchain.com/index.html/",
    {
      maxDepth: 8,
      timeout: 600,
    }
  );
  return loader.load();
}

/**
 * Load all of the LangChain docs via the sitemap.
 * @returns {Promise<Array<DocumentInterface>>}
 */
async function loadLangChainDocs(): Promise<Array<DocumentInterface>> {
  const loader = new SitemapLoader("https://js.langchain.com/");
  return loader.load();
}

function getEmbeddingsModel(): Embeddings {
  return new OpenAIEmbeddings();
}

async function ingestDocs() {
  if (
    !process.env.WEAVIATE_API_KEY ||
    !process.env.WEAVIATE_URL ||
    !process.env.WEAVIATE_INDEX_NAME
  ) {
    throw new Error(
      "WEAVIATE_API_KEY, WEAVIATE_URL, and WEAVIATE_INDEX_NAME must be set in the environment"
    );
  }

  const smithDocs = await loadLangSmithDocs();
  console.debug(`Loaded ${smithDocs.length} docs from LangSmith`);
  const apiDocs = await loadAPIDocs();
  console.debug(`Loaded ${apiDocs.length} docs from API`);
  const langchainDocs = await loadLangChainDocs();
  console.debug(`Loaded ${langchainDocs.length} docs from documentation`);

  if (!smithDocs.length || !apiDocs.length || !langchainDocs.length) {
    process.exit(1);
  }

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkOverlap: 200,
    chunkSize: 4000,
  });
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
    if (!doc.metadata.title) {
      doc.metadata.title = "";
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weaviateClient = (weaviate as any).client({
    scheme: "https",
    host: process.env.WEAVIATE_URL,
    apiKey: new ApiKey(process.env.WEAVIATE_API_KEY),
  }) as WeaviateClient;

  const embeddings = getEmbeddingsModel();
  const vectorStore = new WeaviateStore(embeddings, {
    client: weaviateClient,
    indexName: process.env.WEAVIATE_INDEX_NAME,
    textKey: "text",
  });

  const connectionOptions = process.env.RECORD_MANAGER_DB_URL
    ? {
        connectionString: process.env.RECORD_MANAGER_DB_URL,
      }
    : {
        host: process.env.DATABASE_HOST,
        port: Number(process.env.DATABASE_PORT),
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
      };

  const recordManager = new PostgresRecordManager(
    `weaviate/${process.env.WEAVIATE_INDEX_NAME}`,
    {
      postgresConnectionOptions: connectionOptions,
    }
  );
  await recordManager.createSchema();

  const indexingStats = await index({
    docsSource: docsTransformed,
    recordManager,
    vectorStore,
    cleanup: "full",
    sourceIdKey: "source",
    forceUpdate: process.env.FORCE_UPDATE === "true",
  });

  console.log(
    {
      indexingStats,
    },
    "Indexing stats"
  );

  const nodeStatus = await weaviateClient.cluster.nodesStatusGetter().do();
  let numVecs = 0;
  nodeStatus.nodes?.forEach((node) => {
    numVecs += node.stats?.objectCount ?? 0;
  });
  console.log(`LangChain now has this many vectors: ${numVecs}`);
}

ingestDocs().catch((e) => {
  console.error("Failed to ingest docs");
  console.error(e);
  process.exit(1);
});
