# 🦜️🔗 Chat LangChain.js

This repo is an implementation of a locally hosted chatbot specifically focused on question answering over the [LangChain documentation](https://langchain.readthedocs.io/en/latest/).
Built with [LangChain](https://github.com/langchain-ai/langchainjs/), and [Next.js](https://nextjs.org).

Deployed version: [chatjs.langchain.com](https://chatjs.langchain.com)

> Looking for the Python version? Click [here](https://github.com/langchain-ai/chat-langchain)

## ✅ Local development
1. Install dependencies via: `yarn install`.
2. Set the required environment variables listed inside [`backend/.env.example`](backend/.env.example) for the backend, and [`frontend/.env.example`](frontend/.env.example) for the frontend.

### Ingest
1. Build the backend via `yarn build --filter=backend` (from root).
2. Run the ingestion script by navigating into `./backend` and running `yarn ingest`.

### Frontend
1. Navigate into `./frontend` and run `yarn dev` to start the frontend.
2. Open [localhost:3000](http://localhost:3000) in your browser.

## 📚 Technical description

There are two components: ingestion and question-answering.

Ingestion has the following steps:

1. Pull html from documentation site as well as the Github Codebase
2. Load html with LangChain's [RecursiveUrlLoader](https://api.js.langchain.com/classes/langchain_document_loaders_web_recursive_url.RecursiveUrlLoader.html) and [SitemapLoader](https://js.langchain.com/docs/integrations/document_loaders/web_loaders/sitemap)
3. Split documents with LangChain's [RecursiveCharacterTextSplitter](https://js.langchain.com/docs/modules/data_connection/document_transformers/recursive_text_splitter)
4. Create a vectorstore of embeddings, using LangChain's [Weaviate vectorstore wrapper](https://js.langchain.com/docs/integrations/vectorstores/weaviate) (with OpenAI's embeddings).

Question-Answering has the following steps:

1. Given the chat history and new user input, determine what a standalone question would be using GPT-3.5.
2. Given that standalone question, look up relevant documents from the vectorstore.
3. Pass the standalone question and relevant documents to the model to generate and stream the final answer.
4. Generate a trace URL for the current chat session, as well as the endpoint to collect feedback.

## Documentation

Looking to use or modify this Use Case Accelerant for your own needs? We've added a few docs to aid with this:

- **[Concepts](./CONCEPTS.md)**: A conceptual overview of the different components of Chat LangChain. Goes over features like ingestion, vector stores, query analysis, etc.
- **[Modify](./MODIFY.md)**: A guide on how to modify Chat LangChain for your own needs. Covers the frontend, backend and everything in between.
- **[Running Locally](./RUN_LOCALLY.md)**: The steps to take to run Chat LangChain 100% locally.
- **[LangSmith](./LANGSMITH.md)**: A guide on adding robustness to your application using LangSmith. Covers observability, evaluations, and feedback.
- **[Production](./PRODUCTION.md)**: Documentation on preparing your application for production usage. Explains different security considerations, and more.
- **[Deployment](./DEPLOYMENT.md)**: How to deploy your application to production. Covers setting up production databases, deploying the frontend, and more.
