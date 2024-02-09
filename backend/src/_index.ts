import { RecordManagerInterface } from "@langchain/community/indexes/base";
import { DocumentInterface } from "@langchain/core/documents";
import { VectorStore } from "@langchain/core/vectorstores";
import { BaseDocumentLoader } from "langchain/document_loaders/base";
import { _HashedDocument, _batch, _deduplicateInOrder, _getSourceIdAssigner } from "langchain/indexes";

const DEFAULTS = {
  batchSize: 100,
  cleanupBatchSize: 1000,
  forceUpdate: false,
};

export async function index(options: {
  docsSource: BaseDocumentLoader | Array<DocumentInterface>,
  recordManager: RecordManagerInterface,
  vectorStore: VectorStore,
  /**
   * @default 100
   */
  batchSize?: number,
  cleanup?: "incremental" | "full",
  sourceIdKey: string | ((doc: DocumentInterface) => string),
  /**
   * @default {1000}
   */
  cleanupBatchSize?: number,
  /**
   * @default false
   */
  forceUpdate?: boolean,
}): Promise<{
  numAdded: number;
  numSkipped: number;
  numDeleted: number;
}> {
  const {
    docsSource,
    recordManager,
    vectorStore,
    batchSize,
    cleanup,
    sourceIdKey,
    cleanupBatchSize,
    forceUpdate,
  } = { ...DEFAULTS, ...options };

  if (cleanup === "incremental" && !sourceIdKey) {
    throw new Error("Source id key is required when cleanup mode is incremental.");
  }

  let docs: Array<DocumentInterface>;
  if (!Array.isArray(docsSource)) {
    try {
      docs = await docsSource.load();
    } catch (e) {
      throw new Error("Error loading documents from source" + e);
    }
  } else {
    docs = docsSource;
  }

  const sourceIdAssigner = _getSourceIdAssigner(sourceIdKey);

  // Mark when the update started.
  const indexStartDt = await recordManager.getTime()
  let numAdded = 0
  let numSkipped = 0
  let numDeleted = 0

  for (const docBatch of _batch(batchSize, docs)) {
    const hashedDocs = _deduplicateInOrder(
      docBatch.map(doc => _HashedDocument.fromDocument(doc))
    );

    let sourceIds = hashedDocs.map(sourceIdAssigner);

    if (cleanup === "incremental") {
      // If the cleanup mode is incremental, source ids are required.
      for (let i = 0; i < sourceIds.length; i++) {
        const sourceId = sourceIds[i];
        const hashedDoc = hashedDocs[i];
        if (sourceId === null) {
          throw new Error(
            `Source ids are required when cleanup mode is incremental.\nDocument that starts with content: ${hashedDoc.pageContent.substring(0, 100)} was not assigned as source id.`
          );
        }
      }
      // source ids cannot be null after for loop above.
      sourceIds = sourceIds as Array<string>;
    }

    const existsBatch = await recordManager.exists(hashedDocs.map(({ uid }) => uid));
    
    // Filter out documents that already exist in the record store.
    const uids: Array<string> = [];
    const docsToIndex: Array<DocumentInterface> = [];
    const uidsToRefresh: Array<string> = [];

    for (let i = 0; i < hashedDocs.length; i++) {
      const hashedDoc = hashedDocs[i];
      const docExists = existsBatch[i];
      if (docExists && !forceUpdate) {
        uidsToRefresh.push(hashedDoc.uid);
        continue;
      }
      uids.push(hashedDoc.uid);
      docsToIndex.push(hashedDoc.toDocument());
    }

    // Update refresh timestamp
    if (uidsToRefresh.length) {
      recordManager.update(uidsToRefresh, { timeAtLeast: indexStartDt });
      numSkipped += uidsToRefresh.length;
    }

    // Be pessimistic and assume that all vector store write will fail.
    // First write to vector store
    if (docsToIndex.length) {
      await vectorStore.addDocuments(docsToIndex, { ids: uids });
      numAdded += docsToIndex.length;
    }

    // And only then update the record store.
    // Update ALL records, even if they already exist since we want to refresh
    // their timestamp.
    await recordManager.update(hashedDocs.map(({ uid }) => uid), {
      groupIds: sourceIds,
      timeAtLeast: indexStartDt,
    });

    // If source IDs are provided, we can do the deletion incrementally!
    if (cleanup === "incremental") {
      // Get the uids of the documents that were not returned by the loader.

      // TS isn't good enough to determine that source ids cannot be null
      // here due to a check that's happening above, so we check again.
      sourceIds.forEach((id) => {
        if (id === null) {
          throw new Error("Source ids cannot be null here.");
        }
      });

      const _sourceIds = sourceIds as Array<string>;

      const uidsToDelete = await recordManager.listKeys({
        groupIds: _sourceIds,
        before: indexStartDt,
      });

      if (uidsToDelete.length) {
        // Then delete from vector store
        await vectorStore.delete(uidsToDelete);
        // Finally delete from record store
        await recordManager.deleteKeys(uidsToDelete);
        numDeleted += uidsToDelete.length;
      }
    }
  }

  if (cleanup === "full") {
    let uidsToDelete: string[] | undefined;
    while ((uidsToDelete = await recordManager.listKeys({
      before: indexStartDt,
      limit: cleanupBatchSize,
    }))) {
      // First delete from vector store.
      await vectorStore.delete(uidsToDelete);
      // Then delete from record manager.
      await recordManager.deleteKeys(uidsToDelete);
      numDeleted += uidsToDelete.length;
    }
  }

  return {
    numAdded,
    numSkipped,
    numDeleted,
  };
}