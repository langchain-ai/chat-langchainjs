# Modifying

The Chat LangChain repo was built to serve two use cases. The first being question answering over the LangChain documentation. The second is to offer a production ready chat bot which you can easily customize for your specific use case. In this doc we'll go over each step you need to take to customize the repo for your need.

## Frontend

The frontend doesn't have much LangChain specific code that would need modification. The main parts are the LangChain UI branding and question suggestions.

To modify the main LangChain branding visit the [`ChatWindow.tsx`](frontend/app/components/ChatWindow.tsx) file to modify/remove. Next, to update the question suggestions, visit the [`EmptyState.tsx`](frontend/app/components/EmptyState.tsx) file. Finally, update the "View Source" button on the bottom of the page by going back to the [`ChatWindow.tsx`](frontend/app/components/ChatWindow.tsx) file.

## Backend (API)

The backend contains two parts, the first is the ingestion script which lives inside of the [/backend](/backend/) directory. The second are the API endpoints which are located inside the frontend: [/frontend/app/api](/frontend/app/api).

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

### API Endpoints

Once you've updated your ingestion script to populate your vector store, you'll need to update the different API endpoints to reflect your new data. 

The first (and main endpoint) is the [`/api/chat/stream_log`](frontend/app/api/chat/stream_log/route.ts). This is where the main API code lives.

- Answer generation prompt
- Question rephrasing (query analysis) prompt
- Document retrieval

#### Document Retrieval

The document retrieval code is the only part of this API which is not LangChain.js documentation specific. You can however, easily add or remove parts to increase/fit your needs better. Some ideas of what can be done:

- Re-ranking document results
- Parent document retrieval (also would require modifications to the ingestion script)
- Document verification via LLM


#### Answer Generation Prompt

The prompt used for answer generation is one of the most important parts of this RAG pipeline. Without a good prompt, the LLM will be unable (or severely limited) to generate good answers.

The prompt is defined in the `RESPONSE_TEMPLATE` variable.

You should modify the parts of this which are LangChain specific to instead fit your needs. If possible, and if your use case does not differ too much from the Chat LangChain use case, you should do your best to keep the same structure as the original prompt. Although there are likely some improvements to be made, we've refined this prompt over many months and lots of user feedback to what we believe to be a well formed prompt.

#### Question Rephrasing Prompt

Finally, you can (but not necessary required) modify the `REPHRASE_TEMPLATE` variable to contain more domain specific content about, for example, the types of followup questions you expect to receive. Having a good rephrasing prompt will help the LLM to better understand the user's question and generate a better prompt which will have compounding effects downstream.