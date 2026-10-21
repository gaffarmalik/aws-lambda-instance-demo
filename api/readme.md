# API and worker

From the repository root, use `npm run dev` for local simulation or `npm run dev:aws` after setting AWS environment variables. See the [main README](../README.md) for setup and guarantees.

- `src/server.ts`: one local Express process and volatile collector.
- `src/collector.ts`: validation-backed collection, serialized batch exports, stable retry identity, timer.
- `src/worker.ts`: independent batch-processing logic, conditional commit, retry-safe status.
- `src/lambda.ts`: deployed S3-event handler; never starts Express.
- `src/local-worker.ts`: separate polling process for local rehearsal.
- `src/model.ts`: separate classification/explanation prompts, strict model output validation, labeled local simulation.
- `src/dashboard.ts`: filter saved results, calculate comparisons, track incomplete coverage, save answers.
- `src/store.ts`: S3 SDK adapter and local filesystem simulation.

| Method | Route                                                         | Purpose                                                             |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/config`                                                 | Branch catalog and explicit mode/model                              |
| POST   | `/api/feedback`                                               | `{branchId,item,rating,comment}` → unique ID and confirmation       |
| POST   | `/api/samples`                                                | `{count: 1..200}` → sample collection, default 24                   |
| GET    | `/api/buffer`                                                 | Count, next deadline, upload/retry/error information                |
| POST   | `/api/batches/flush`                                          | Export up to 200 buffered records                                   |
| GET    | `/api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=ikeja` | Filtered metrics, batch states, coverage, recent evidence           |
| POST   | `/api/questions`                                              | `{question,filters:{from,to,branchId}}` → saved answer and evidence |
| GET    | `/api/evidence/:batchId/:feedbackId`                          | Original classified feedback and provenance                         |
| GET    | `/api/object?key=...`                                         | Read a JSON object under an allowed demo prefix                     |

Dates are inclusive UTC submission dates. Omitted dates default to this Monday through today. An omitted branch selects all branches. Country, region, timestamp and ID come from the server, never the submitted form. Ratings must be integer numbers from 1 to 5; comments contain 3–2,000 non-whitespace-trimmed characters and purchased items 1–120. No model call occurs during collection.
