## ENF CI Fleet Tooling
This repository contains the various tooling that powers ENF's CI fleet which operates on Google Cloud.

Runner instances are spooled up on demand and managed via:
* **runner.function** - A webhook that receives notifications of new queued jobs from GitHub Actions and starts a,
* **runner.workflow** - A workflow which starts and manages the lifecycle of a,
* **runner.vm** - A disk image that downloads the GitHub Action Runner and runs it for a single job.

Additionally, monitoring is provided by:
* **budget.function** - Stores current monthly cost in Firestore.
* **monitor-enqueuer.function** - Scheduled once a minute to queue up 6 calls to,
* **monitor.function** - Collects various metrics and posts them to Telegram.