# fixtures

Small example exports, used by the README and as something to point `check` at.

- `langsmith-sample.jsonl` — two LangChain runs with `inputs`/`outputs` objects and a child
  retriever run. One answer is faithful, one invents a figure. Run:

  ```
  npx github:harsh01369/silentgreen check fixtures/langsmith-sample.jsonl
  ```
